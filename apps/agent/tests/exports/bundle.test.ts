import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Filename } from '@repo/protocol';
import { Effect, Either, Layer } from 'effect';
import { bundleBinaryName, writeBundle } from '#exports/bundle.ts';
import { artifactStore } from '#tests/support/artifacts.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { artifact } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const DEVICE_PATH = '/dev/nbd7';

const run = provided(Layer.merge(artifactStore(), platform));

/** What a real `debugfs` and `tar` would leave behind, so each step downstream has its input. */
function bundling({ dump = true }: { dump?: boolean } = {}) {
  return Effect.gen(function* () {
    const stagingDir = yield* temporaryDirectory;
    const { commands, layer } = recordingCommands(({ command }) =>
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

    const result = yield* Effect.either(
      Effect.provide(
        writeBundle({ artifact: artifact(), devicePath: DEVICE_PATH, stagingDir }),
        layer,
      ),
    );
    return { commands, result, stagingDir };
  });
}

test('reads the device with debugfs and never mounts it', async () => {
  const { commands, stagingDir } = await run(bundling());

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
  const { commands, result, stagingDir } = await run(bundling());

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
  expect(Either.isRight(result)).toBe(true);
});

test('a dump that produced nothing is a failure rather than an empty bundle', async () => {
  const { result } = await run(bundling({ dump: false }));

  expect(Either.isLeft(result) && result.left._tag).toBe('EmptyDump');
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
