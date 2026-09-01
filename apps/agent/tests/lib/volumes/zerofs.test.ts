import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CheckpointIdSchema, Value } from '@repo/protocol';
import { Effect, Option } from 'effect';
import {
  cacheDiskGigabytes,
  cacheMemoryGigabytes,
  createCheckpoint,
  deleteCheckpoint,
  flush,
  listCheckpoints,
  parseCheckpointNames,
} from '#lib/volumes/zerofs.ts';
import { recordingCommands } from '#tests/support/commands.ts';

const BINARY = '/opt/nibrun/bin/zerofs/zerofs';
/** What `infra/app-host/zerofs/config.toml` and `checkpoint.toml` hold this host's disk at. */
const DEPLOYED_CACHE_GIB = 70;
/** And what the same file lets it hold in memory, which is memory no guest may be given. */
const DEPLOYED_MEMORY_GIB = 2;
const CHECKPOINT_CACHE_GIB = 4;
const target = { binary: BINARY, configFile: '/etc/z.toml' };
const checkpointId = Value.Parse(CheckpointIdSchema, 'cp-1');

// The deploy puts every binary under a versioned path and none on PATH, so a bare name resolves
// to nothing — and the flush that fails is the one that makes a stop a durability point.
describe('ZeroFS is invoked where the deploy put it', () => {
  test('a flush names the binary in full', async () => {
    const { commands, layer } = recordingCommands();
    await Effect.runPromise(Effect.provide(flush(target), layer));
    expect(commands[0]?.command[0]).toBe(BINARY);
  });

  test('so does every checkpoint command', async () => {
    const { executables, layer } = recordingCommands();
    await Effect.runPromise(
      Effect.provide(
        Effect.all([
          createCheckpoint({ target, checkpointId }),
          deleteCheckpoint({ target, checkpointId }),
          listCheckpoints(target),
        ]),
        layer,
      ),
    );
    expect(executables().every((executable) => executable === BINARY)).toBe(true);
  });
});

test('only the checkpoint name is read off each line', () => {
  expect(parseCheckpointNames('cp-1  2026-08-04\n\n cp-2 \n')).toEqual(['cp-1', 'cp-2']);
});

/**
 * How much of the instance store is not the agent's to spend. Against the committed config rather
 * than a fixture, because the value only means anything if it comes out of the file the deploy
 * puts on the host — a renamed key or a moved section is this reading silently going missing.
 */
describe('the disk ZeroFS is entitled to is read out of its own config', () => {
  test('the config an app host is deployed with says what it says', async () => {
    const config = await readFile(
      join(import.meta.dir, '../../../../../infra/app-host/zerofs/config.toml'),
      'utf8',
    );
    expect(cacheDiskGigabytes(config)).toEqual(Option.some(DEPLOYED_CACHE_GIB));
  });

  // ZeroFS expands these itself, so what is on disk is never the config it ends up running with.
  test('a config whose variable references are still unexpanded parses anyway', () => {
    const unexpanded = `[cache]\ndisk_size_gb = ${CHECKPOINT_CACHE_GIB}.0\n\n[storage]\nurl = "\${NIBRUN_FILESYSTEMS_URL}"\n`;
    expect(cacheDiskGigabytes(unexpanded)).toEqual(Option.some(CHECKPOINT_CACHE_GIB));
  });

  // Nothing downstream may treat an unreadable number as a reason to help itself to the disk.
  test('a file that is not a config, or a config without the key, reads as nothing', () => {
    expect(cacheDiskGigabytes('not a config at all {')).toEqual(Option.none());
    expect(cacheDiskGigabytes('[cache]\ndir = "/data/zerofs"\n')).toEqual(Option.none());
  });
});

/**
 * Read for the same reason the disk is, against the same file: ZeroFS grows into this lazily, so
 * a host with memory free is not a host with memory to spare. A renamed key or a moved section is
 * this reading silently going missing, and a host then selling ZeroFS's cache to tenants.
 */
describe('the memory ZeroFS is entitled to is read out of its own config', () => {
  test('the config an app host is deployed with says what it says', async () => {
    const config = await readFile(
      join(import.meta.dir, '../../../../../infra/app-host/zerofs/config.toml'),
      'utf8',
    );

    expect(cacheMemoryGigabytes(config)).toEqual(Option.some(DEPLOYED_MEMORY_GIB));
  });

  test('a config naming only the disk says nothing about the memory', () => {
    expect(cacheMemoryGigabytes('[cache]\ndisk_size_gb = 70.0\n')).toEqual(Option.none());
  });
});
