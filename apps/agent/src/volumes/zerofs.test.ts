import { describe, expect, test } from 'bun:test';
import type { CheckpointId } from '@repo/protocol';
import type { CommandRequest } from '#lib/exec.ts';
import { ZerofsAdmin } from '#volumes/zerofs.ts';

const NO_EXIT_CODE = 0;
const BINARY = '/opt/nibrun/bin/zerofs/zerofs';

function recordingAdmin() {
  const commands: string[][] = [];
  const runner = (request: CommandRequest) => {
    commands.push([...request.command]);
    return Promise.resolve({ code: NO_EXIT_CODE, stdout: '', stderr: '' });
  };
  return {
    commands,
    admin: new ZerofsAdmin({ runner, binary: BINARY, configFile: '/etc/z.toml' }),
  };
}

// The deploy lays every binary down under a versioned path and puts none of them on PATH, so a
// bare name resolves to nothing — and the flush that fails is the one that makes a stop a
// durability point under ignore_fsync.
describe('ZeroFS is invoked where the deploy put it', () => {
  test('a flush names the binary in full', async () => {
    const { commands, admin } = recordingAdmin();
    await admin.flush();

    expect(commands[0]?.[0]).toBe(BINARY);
  });

  test('so does every checkpoint command', async () => {
    const { commands, admin } = recordingAdmin();
    await admin.createCheckpoint({ checkpointId: 'cp-1' as CheckpointId });
    await admin.deleteCheckpoint({ checkpointId: 'cp-1' as CheckpointId });
    await admin.listCheckpoints();

    expect(commands.every(([executable]) => executable === BINARY)).toBe(true);
  });
});
