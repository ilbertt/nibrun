import type { CheckpointId } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { readTextFile } from '#lib/json-store.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

/**
 * ZeroFS's `gb` read as GiB, the larger of the two it could mean. The reading is only ever used
 * to hold disk back for it, and reserving five gigabytes too many costs a cold boot where
 * reserving five too few costs the cache every app on the host runs from.
 */
const BYTES_PER_CONFIGURED_GB = 1_073_741_824;

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
export const flush = Effect.fn('zerofs.flush')((target: ZerofsAdmin) =>
  admin({ target, args: ['flush'] }),
);

export const createCheckpoint = Effect.fn('zerofs.createCheckpoint')(
  ({ target, checkpointId }: { target: ZerofsAdmin; checkpointId: CheckpointId }) =>
    stdoutOf({
      command: [target.binary, 'checkpoint', 'create', '-c', target.configFile, checkpointId],
    }),
);

export const deleteCheckpoint = Effect.fn('zerofs.deleteCheckpoint')(
  ({ target, checkpointId }: { target: ZerofsAdmin; checkpointId: CheckpointId }) =>
    stdoutOf({
      command: [target.binary, 'checkpoint', 'delete', '-c', target.configFile, checkpointId],
    }),
);

export const listCheckpoints = Effect.fn('zerofs.listCheckpoints')((target: ZerofsAdmin) =>
  Effect.map(admin({ target, args: ['checkpoint', 'list'] }), parseCheckpointNames),
);

export class ZerofsCacheUnknown extends Data.TaggedError('ZerofsCacheUnknown')<{
  readonly path: string;
}> {
  override get message() {
    return `${this.path} does not say how much disk ZeroFS may cache on`;
  }
}

/**
 * How much of the disk ZeroFS is entitled to, read out of the file it is itself started with
 * rather than written down a second time here. It grows into that number lazily, so a disk that
 * looks empty today is one whose free space is already spoken for — and anything else that writes
 * to the same disk has to hold this much back rather than what ZeroFS happens to be holding now.
 */
export const readCacheDiskBytes = Effect.fn('zerofs.readCacheDiskBytes')(function* (
  configFile: string,
) {
  const configured = Option.flatMap(yield* readTextFile(configFile), cacheDiskGigabytes);
  if (Option.isNone(configured)) {
    return yield* new ZerofsCacheUnknown({ path: configFile });
  }
  return configured.value * BYTES_PER_CONFIGURED_GB;
});

/** `[cache] disk_size_gb`, or nothing at all: a value this cannot read is not one to guess at. */
export function cacheDiskGigabytes(config: string): Option.Option<number> {
  try {
    const { cache } = Bun.TOML.parse(config) as { cache?: { disk_size_gb?: unknown } };
    const configured = cache?.disk_size_gb;
    return typeof configured === 'number' && configured > 0
      ? Option.some(configured)
      : Option.none();
  } catch {
    return Option.none();
  }
}

export function parseCheckpointNames(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0] ?? '')
    .filter((name) => name.length > 0);
}
