import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { FilenameSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Layer } from 'effect';
import { writeNibrunnerExportBundle } from '#lib/nibrunner/export-bundle.ts';
import { tarEntries } from '#lib/volumes/tar.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { ARTIFACT_BYTES, artifactStore } from '#tests/support/artifacts.ts';
import { artifact } from '#tests/support/fixtures.ts';
import { preparedNibrunnerExport } from '#tests/support/nibrunner.ts';
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
      artifactBucket: 'binaries',
      stagingDir: `${directory}/work`,
    },
  };
});

async function contents(file: string) {
  const entries = new Map<string, { kind: string; mode: number; link: string; body: Uint8Array }>();
  for await (const entry of tarEntries(
    Bun.file(file).stream().pipeThrough(new DecompressionStream('gzip')),
  )) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of entry.content()) {
      chunks.push(chunk);
    }
    entries.set(entry.path.replace(/\/+$/, ''), {
      kind: entry.kind,
      mode: entry.mode,
      link: entry.linkTarget,
      body: Buffer.concat(chunks),
    });
  }
  return entries;
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
      const entries = yield* Effect.promise(() => contents(bundle.path));
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
      const entries = yield* Effect.promise(() => contents(bundle.path));
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
        const entries = yield* Effect.promise(() => contents(bundle.path));
        expect(entries.get(`${filename}.binary`)?.body).toEqual(ARTIFACT_BYTES);
        expect(new TextDecoder().decode(entries.get('crontab')?.body)).toBe('@hourly app\n');
      }),
    );
  },
);
