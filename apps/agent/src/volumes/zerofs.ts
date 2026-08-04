import type { CheckpointId } from '@repo/protocol';
import { Effect } from 'effect';
import { stdoutOf } from '#lib/exec.ts';

/**
 * ZeroFS is a long-running service this agent does not own. Restarting it stalls every attached
 * microVM at once and drops whatever was acknowledged but unflushed, so the agent only ever
 * talks to it over the admin RPC.
 */
export type ZerofsAdmin = {
  readonly binary: string;
  readonly configFile: string;
};

const admin = ({ target, args }: { target: ZerofsAdmin; args: readonly string[] }) =>
  stdoutOf({ command: [target.binary, ...args, '-c', target.configFile] });

/** With `ignore_fsync` the guest's own flushes are a no-op, so this is what makes writes durable. */
export const flush = (target: ZerofsAdmin) => admin({ target, args: ['flush'] });

export const createCheckpoint = ({
  target,
  checkpointId,
}: {
  target: ZerofsAdmin;
  checkpointId: CheckpointId;
}) =>
  stdoutOf({
    command: [target.binary, 'checkpoint', 'create', '-c', target.configFile, checkpointId],
  });

export const deleteCheckpoint = ({
  target,
  checkpointId,
}: {
  target: ZerofsAdmin;
  checkpointId: CheckpointId;
}) =>
  stdoutOf({
    command: [target.binary, 'checkpoint', 'delete', '-c', target.configFile, checkpointId],
  });

export const listCheckpoints = (target: ZerofsAdmin) =>
  Effect.map(admin({ target, args: ['checkpoint', 'list'] }), parseCheckpointNames);

export function parseCheckpointNames(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0] ?? '')
    .filter((name) => name.length > 0);
}
