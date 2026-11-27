import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { FilenameSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Layer } from 'effect';
import { writeNibrunnerExportBundle } from '#export-bundle.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { ARTIFACT_BYTES, artifactStore } from '#tests/support/artifacts.ts';
import { artifact } from '#tests/support/fixtures.ts';
import { preparedNibrunnerExport } from '#tests/support/nibrunner.ts';
import { ociImage } from '#tests/support/oci-image.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(
  Layer.mergeAll(CommandRunner.Default.pipe(Layer.provideMerge(platform)), artifactStore()),
);
const RUNNABLE_MODE = 0o755;

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* temporaryDirectory;
  const preparedDirectory = `${directory}/prepared`;
  const data = `${preparedDirectory}/data/app/data`;
  yield* preparedNibrunnerExport(preparedDirectory);
  return {
    fs,
    directory,
    data,
    input: {
      preparedDirectory,
      artifact: artifact(),
      config: undefined,
      artifactBucket: 'binaries',
      stagingDir: `${directory}/work`,
    },
  };
});

function archiveEntry(path: string) {
  const stat = lstatSync(path);
  return {
    kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
    mode: stat.mode & 0o777,
    link: stat.isSymbolicLink() ? readlinkSync(path) : '',
    body: stat.isFile() ? readFileSync(path) : new Uint8Array(),
  };
}

function contents(file: string) {
  const directory = mkdtempSync(join(tmpdir(), 'nibrun-export-test-'));
  const entries = new Map<string, { kind: string; mode: number; link: string; body: Uint8Array }>();
  function collect(parent: string) {
    for (const name of readdirSync(join(directory, parent))) {
      const relative = join(parent, name);
      const path = join(directory, relative);
      const entry = archiveEntry(path);
      entries.set(relative, entry);
      if (entry.kind === 'directory') {
        collect(relative);
      }
    }
  }
  try {
    execFileSync('tar', ['-xzf', file, '-C', directory]);
    collect('');
    return entries;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('a prepared directory produces one nibrun archive containing only app data and verified executable', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, input } = yield* fixture;
      yield* fs.makeDirectory(`${input.preparedDirectory}/data/etc`);
      yield* fs.writeFileString(`${input.preparedDirectory}/data/etc/private`, 'outside app data');
      yield* fs.writeFileString(`${input.preparedDirectory}/.env`, 'TOKEN="kept secret"\n', {
        mode: 0o600,
      });
      yield* fs.writeFileString(`${input.preparedDirectory}/crontab`, '@hourly app\n', {
        mode: 0o600,
      });
      const bundle = yield* writeNibrunnerExportBundle(input);
      const entries = yield* Effect.sync(() => contents(bundle.path));
      expect([...entries.keys()].sort()).toEqual(
        ['.env', 'crontab', 'data', 'data/app.db', input.artifact.filename].sort(),
      );
      expect(new TextDecoder().decode(entries.get('data/app.db')?.body)).toBe('committed database');
      expect(entries.get(input.artifact.filename)?.body).toEqual(ARTIFACT_BYTES);
      expect(entries.get(input.artifact.filename)?.mode).toBe(RUNNABLE_MODE);
      expect(new TextDecoder().decode(entries.get('.env')?.body)).toBe('TOKEN="kept secret"\n');
      expect(yield* fs.exists(`${input.stagingDir}/data`)).toBe(false);
      expect(yield* fs.exists(`${input.preparedDirectory}/bundle.tar.gz`)).toBe(false);
    }),
  );
});

test('guest symlinks stay links without reading their host targets', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, data, directory, input } = yield* fixture;
      const outside = `${directory}/host-only`;
      yield* fs.writeFileString(outside, 'host-only content');
      yield* fs.symlink(outside, `${data}/link`);
      const bundle = yield* writeNibrunnerExportBundle(input);
      const entries = yield* Effect.sync(() => contents(bundle.path));
      expect(entries.get('data/link')).toMatchObject({ kind: 'symlink', link: outside });
      expect(new TextDecoder().decode(entries.get('data/link')?.body)).not.toContain(
        'host-only content',
      );
    }),
  );
});

test.each(['data', 'data/app', 'data/app/data', '.env', 'crontab'])(
  'symlinks replacing a selected source are refused before archiving: %s',
  async (member) => {
    await run(
      Effect.gen(function* () {
        const { fs, input, directory } = yield* fixture;
        const source = `${input.preparedDirectory}/${member}`;
        yield* fs.remove(source, { recursive: true, force: true });
        yield* fs.symlink(directory, source);
        expect((yield* Effect.flip(writeNibrunnerExportBundle(input)))._tag).toBe(
          'InvalidNibrunnerExport',
        );
        expect(yield* fs.exists(input.stagingDir)).toBe(false);
      }),
    );
  },
);

test.each(['data', 'bundle.tar.gz', 'crontab'])(
  'the executable cannot collide with prepared metadata: %s',
  async (filename) => {
    await run(
      Effect.gen(function* () {
        const { fs, input } = yield* fixture;
        yield* fs.writeFileString(`${input.preparedDirectory}/crontab`, '@hourly app\n');
        const bundle = yield* writeNibrunnerExportBundle({
          ...input,
          artifact: artifact({ filename: Value.Parse(FilenameSchema, filename) }),
        });
        const entries = yield* Effect.sync(() => contents(bundle.path));
        expect(entries.get(`${filename}.binary`)?.body).toEqual(ARTIFACT_BYTES);
        expect(new TextDecoder().decode(entries.get('crontab')?.body)).toBe('@hourly app\n');
      }),
    );
  },
);

test('image exports retain the entire writable overlay and pinned image metadata', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, input } = yield* fixture;
      yield* fs.makeDirectory(`${input.preparedDirectory}/data/var/lib`, { recursive: true });
      yield* fs.writeFileString(`${input.preparedDirectory}/data/var/lib/state`, 'image state');
      const image = ociImage();
      const bundle = yield* writeNibrunnerExportBundle({ ...input, artifact: image });
      const entries = contents(bundle.path);
      expect(new TextDecoder().decode(entries.get('data/var/lib/state')?.body)).toBe('image state');
      expect(entries.has('data/app/data/app.db')).toBe(true);
      expect(JSON.parse(new TextDecoder().decode(entries.get('image.json')?.body))).toEqual({
        image,
      });
      expect(entries.has(input.artifact.filename)).toBe(false);
    }),
  );
});
