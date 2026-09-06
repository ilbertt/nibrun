import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Option } from 'effect';
import { FILESYSTEM_LABEL, format } from '#lib/volumes/ext4.ts';
import { recordingCommands } from '#tests/support/commands.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);

const SUPERBLOCK_MAGIC_OFFSET = 1080;
const SUPERBLOCK_BYTES = 2048;
/** `0xef53`, as ext4 writes it: little-endian, so the low byte comes first. */
const EXT_MAGIC_LOW = 0x53;
const EXT_MAGIC_HIGH = 0xef;

/** A device as ZeroFS first exports one: the length is there, and nothing has been written to it. */
function blank(): Buffer {
  return Buffer.alloc(SUPERBLOCK_BYTES);
}

function alreadyFormatted(): Buffer {
  const device = blank();
  device.set([EXT_MAGIC_LOW, EXT_MAGIC_HIGH], SUPERBLOCK_MAGIC_OFFSET);
  return device;
}

function formatting({ device, seedDir }: { device: Buffer; seedDir: Option.Option<string> }) {
  return Effect.gen(function* () {
    const directory = yield* temporaryDirectory;
    const devicePath = join(directory, 'nbd0');
    yield* Effect.promise(() => writeFile(devicePath, device));
    const { commands, layer } = recordingCommands();
    const formatted = yield* Effect.provide(format({ devicePath, seedDir }), layer);
    return { formatted, commands, devicePath };
  });
}

describe('a device is formatted once and only once', () => {
  test('a blank device is given a filesystem', async () => {
    const { formatted, commands, devicePath } = await run(
      formatting({ device: blank(), seedDir: Option.none() }),
    );

    expect(formatted).toBe(true);
    expect(commands.map(({ command }) => command)).toEqual([
      ['mkfs.ext4', '-q', '-L', FILESYSTEM_LABEL, devicePath],
    ]);
  });

  /**
   * The whole of what makes a seed apply once. A device that already carries a filesystem is left
   * alone whatever it was asked to be created from, so a redeploy naming an archive cannot write
   * over what the tenant has since put there.
   */
  test('a device that already carries one is left alone, seed or no seed', async () => {
    const { formatted, commands } = await run(
      formatting({
        device: alreadyFormatted(),
        seedDir: Option.some('/var/lib/nibrun/seeds/tree'),
      }),
    );

    expect(formatted).toBe(false);
    expect(commands).toEqual([]);
  });
});

test('a seed is handed to mkfs as the tree the filesystem is created from', async () => {
  const seedDir = '/var/lib/nibrun/seeds/app-1/tree';
  const { formatted, commands, devicePath } = await run(
    formatting({ device: blank(), seedDir: Option.some(seedDir) }),
  );

  expect(formatted).toBe(true);
  expect(commands[0]?.command).toEqual([
    'mkfs.ext4',
    '-q',
    '-d',
    seedDir,
    '-L',
    FILESYSTEM_LABEL,
    devicePath,
  ]);
  // Nothing mounts the tenant's filesystem to put the data there, which is the point of `-d`.
  expect(commands.some(({ command }) => command[0] === 'mount')).toBe(false);
});

test('a device nothing answers for stops the volume rather than being guessed at', async () => {
  const failed = await run(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const { layer } = recordingCommands();
      return yield* Effect.provide(
        format({ devicePath: join(directory, 'missing'), seedDir: Option.none() }),
        layer,
      ).pipe(Effect.isFailure);
    }),
  );

  expect(failed).toBe(true);
});
