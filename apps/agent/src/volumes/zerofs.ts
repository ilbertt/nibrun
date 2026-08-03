import type { CheckpointId } from '@repo/protocol';
import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';

/**
 * ZeroFS is a long-running service this agent does not own.
 *
 * Restarting it tears down every NBD connection on the host mid-request, with no session state
 * to resume and no reply to the requests already in flight — so every attached microVM stalls
 * at once, and an unclean stop drops whatever had been acknowledged but not yet flushed. The
 * agent therefore only ever talks to it over the admin RPC; starting and stopping it is an
 * operator action with a fleet-wide blast radius, not a step in a reconcile.
 */
export class ZerofsAdmin {
  readonly #runner: CommandRunner;
  readonly #binary: string;
  readonly #configFile: string;

  constructor({
    runner,
    binary,
    configFile,
  }: {
    runner: CommandRunner;
    binary: string;
    configFile: string;
  }) {
    this.#runner = runner;
    this.#binary = binary;
    this.#configFile = configFile;
  }

  // Called before a VM stops or a device detaches: with `ignore_fsync` the guest's own flushes
  // are a no-op, so this is the only thing that turns acknowledged writes into durable ones.
  async flush(): Promise<void> {
    await runCommandOrThrow({
      runner: this.#runner,
      request: { command: [this.#binary, 'flush', '-c', this.#configFile] },
    });
  }

  async createCheckpoint({ checkpointId }: { checkpointId: CheckpointId }): Promise<void> {
    await runCommandOrThrow({
      runner: this.#runner,
      request: {
        command: [this.#binary, 'checkpoint', 'create', '-c', this.#configFile, checkpointId],
      },
    });
  }

  async deleteCheckpoint({ checkpointId }: { checkpointId: CheckpointId }): Promise<void> {
    await runCommandOrThrow({
      runner: this.#runner,
      request: {
        command: [this.#binary, 'checkpoint', 'delete', '-c', this.#configFile, checkpointId],
      },
    });
  }

  async listCheckpoints(): Promise<string[]> {
    const output = await runCommandOrThrow({
      runner: this.#runner,
      request: { command: [this.#binary, 'checkpoint', 'list', '-c', this.#configFile] },
    });
    return parseCheckpointNames(output);
  }
}

// `zerofs checkpoint list` prints one checkpoint per line; only named checkpoints are listed,
// and every name this agent creates is a checkpoint id.
export function parseCheckpointNames(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/)[0] ?? '')
    .filter((name) => name.length > 0);
}
