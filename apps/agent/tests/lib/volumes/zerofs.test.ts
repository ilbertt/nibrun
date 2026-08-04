import { describe, expect, test } from 'bun:test';
import type { CheckpointId } from '@repo/protocol';
import { Effect } from 'effect';
import {
  createCheckpoint,
  deleteCheckpoint,
  flush,
  listCheckpoints,
  parseCheckpointNames,
} from '#lib/volumes/zerofs.ts';
import { recordingCommands } from '#tests/support/commands.ts';

const BINARY = '/opt/nibrun/bin/zerofs/zerofs';
const target = { binary: BINARY, configFile: '/etc/z.toml' };
const checkpointId = 'cp-1' as CheckpointId;

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
