import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesiredArtifact, Filename, ObjectKey, Sha256Digest } from '@repo/protocol';
import { Effect, Either, Layer } from 'effect';
import { bundleBinaryName, writeBundle } from '#exports/bundle.ts';
import type { CommandRequest, CommandRunner } from '#lib/exec.ts';
import { platform, recordingCommands, succeeding } from '#testing.ts';
import { ArtifactStore } from '#vm/artifacts.ts';

const DEVICE_PATH = '/dev/nbd7';
const BINARY_BYTES = new TextEncoder().encode('binary');

const artifacts = Layer.succeed(ArtifactStore, {
  open: () =>
    Effect.sync(
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(BINARY_BYTES);
            controller.close();
          },
        }),
    ),
});

function artifact(overrides: Partial<DesiredArtifact> = {}): DesiredArtifact {
  return {
    digest: new Bun.CryptoHasher('sha256').update(BINARY_BYTES).digest('hex') as Sha256Digest,
    sizeBytes: BINARY_BYTES.byteLength,
    // A uuid, as the api will assign: it carries no name, which is why `filename` exists.
    objectKey: 'artifacts/9f1c2f0e-0d4e-4a1b-9c3a-1f8b6d2e7a45' as ObjectKey,
    filename: 'pocketbase' as Filename,
    ...overrides,
  };
}

let stagingDir: string;

beforeEach(async () => {
  stagingDir = await mkdtemp(join(tmpdir(), 'bundle-test-'));
});

afterEach(async () => {
  await rm(stagingDir, { recursive: true, force: true });
});

// What a real `debugfs` and `tar` would leave behind, so each step downstream has its input.
const stubHost = ({ dump = true }: { dump?: boolean } = {}) =>
  recordingCommands(({ command }: CommandRequest) =>
    Effect.gen(function* () {
      if (command[0] === 'debugfs' && dump) {
        yield* Effect.promise(async () => {
          await mkdir(join(stagingDir, 'data', 'pb_data'), { recursive: true });
          await writeFile(join(stagingDir, 'data', 'pb_data', 'data.db'), 'tenant');
        });
      }
      if (command[0] === 'tar') {
        yield* Effect.promise(() => writeFile(join(stagingDir, 'bundle.tar.gz'), 'archive'));
      }
      return yield* succeeding();
    }),
  );

const build = ({ layer }: { layer: Layer.Layer<CommandRunner> }) =>
  Effect.runPromiseExit(
    Effect.provide(
      writeBundle({ artifact: artifact(), devicePath: DEVICE_PATH, stagingDir }),
      Layer.mergeAll(layer, artifacts, platform),
    ),
  );

test('reads the device with debugfs and never mounts it', async () => {
  const { commands, layer } = stubHost();
  await build({ layer });

  const dump = commands.find((call) => call.command[0] === 'debugfs');
  expect(dump?.command).toEqual([
    'debugfs',
    '-R',
    `rdump / ${join(stagingDir, 'data')}`,
    DEVICE_PATH,
  ]);
  expect(commands.some((call) => call.command[0] === 'mount')).toBe(false);
  // No `-w`: a read-only open is what keeps the export off the tenant's write path.
  expect(dump?.command).not.toContain('-w');
});

test('archives the data tree and the binary under its uploaded name', async () => {
  const { commands, layer } = stubHost();
  const exit = await build({ layer });

  const tar = commands.find((call) => call.command[0] === 'tar');
  expect(tar?.command).toEqual([
    'tar',
    'czf',
    join(stagingDir, 'bundle.tar.gz'),
    '-C',
    stagingDir,
    'data',
    'pocketbase',
  ]);
  // `.` would sweep the archive into itself.
  expect(tar?.command).not.toContain('.');
  expect(exit._tag).toBe('Success');
});

test('a dump that produced nothing is a failure rather than an empty bundle', async () => {
  const { layer } = stubHost({ dump: false });
  const exit = await build({ layer });

  expect(exit._tag === 'Failure' && String(exit.cause)).toContain('EmptyDump');
});

describe('the bundle keeps the name the binary was uploaded under', () => {
  test('the uploaded name is what lands in the archive', () => {
    expect(bundleBinaryName(artifact({ filename: 'pocketbase' as Filename }))).toEqual(
      Either.right('pocketbase'),
    );
  });

  // The schema rejects all of these, so reaching here means a peer that did not honour it. The
  // bundle is extracted by a person on their own machine, so a name that escapes the archive
  // root is refused rather than corrected.
  test.each(['../escape', 'nested/path', '.hidden', '..', '-rf'])(
    'a name that is a path rather than a filename is refused: %s',
    (hostile) => {
      const result = bundleBinaryName(artifact({ filename: hostile as Filename }));
      expect(Either.isLeft(result) && result.left._tag).toBe('UnsafeFilename');
    },
  );
});
