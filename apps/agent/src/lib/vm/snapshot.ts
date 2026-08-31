import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import type { AppId, DeploymentId } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { readJsonFile } from '#lib/json-store.ts';

export const SNAPSHOT_STATE_FILENAME = 'vmstate';
export const SNAPSHOT_MEMORY_FILENAME = 'memory';

/**
 * Written last and consumed first, which is what makes a restore happen at most once: the agent
 * writes it only once the two files beside it are complete, and the launcher deletes it before it
 * execs the Firecracker that will load them. A start that finds no stamp is a cold boot — so an
 * agent that died between the load and the cleanup leaves a microVM that boots off its disk
 * rather than one that resumes from a snapshot the disk has since moved past.
 */
export const SNAPSHOT_STAMP_FILENAME = 'stamp.json';

/** systemd's own, so it changes exactly when `/dev/nbdN` and the tap devices are made again. */
const HOST_BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';

/**
 * What a snapshot may be loaded against, and nothing else.
 *
 * Firecracker restores a microVM's drives, tap and vsock from paths recorded in the vmstate, and
 * never asks whether what sits at those paths is what sat there when the snapshot was taken. A
 * kernel, rootfs or artifact image swapped underneath one restores a guest whose page cache
 * describes bytes that are gone — silent corruption rather than a refusal. Every field here names
 * something that can move while a microVM sleeps.
 */
export type SnapshotStamp = {
  readonly deploymentId: DeploymentId;
  /** `/opt/nibrun/bin/guest-image` is a symlink, so the kernel and rootfs move without the path. */
  readonly guestImageVersion: string;
  readonly hostBootId: string;
  /** The tap, the addresses, the MAC and the NBD minor all derive from this one number. */
  readonly slot: number;
};

/** Ordered by what a reader most wants to hear first, and the only place a field is named twice. */
const DRIFT: readonly (readonly [keyof SnapshotStamp, string])[] = [
  ['deploymentId', 'the app has been deployed again since'],
  ['guestImageVersion', 'the guest image has changed'],
  ['hostBootId', 'the host has rebooted'],
  ['slot', 'the app has moved to another slot'],
];

export class SnapshotUnusable extends Data.TaggedError('SnapshotUnusable')<{
  readonly reason: string;
}> {
  override get message() {
    return `the saved microVM state cannot be restored: ${this.reason}`;
  }
}

export type SnapshotPaths = {
  readonly directory: string;
  readonly statePath: string;
  readonly memoryPath: string;
  readonly stampPath: string;
};

export function snapshotPaths({
  snapshotDir,
  appId,
}: {
  snapshotDir: string;
  appId: AppId;
}): SnapshotPaths {
  const directory = join(snapshotDir, appId);
  return {
    directory,
    statePath: join(directory, SNAPSHOT_STATE_FILENAME),
    memoryPath: join(directory, SNAPSHOT_MEMORY_FILENAME),
    stampPath: join(directory, SNAPSHOT_STAMP_FILENAME),
  };
}

export function readStamp(value: unknown): Option.Option<SnapshotStamp> {
  if (value === null || typeof value !== 'object') {
    return Option.none();
  }
  const { deploymentId, guestImageVersion, hostBootId, slot } = value as Partial<SnapshotStamp>;
  if (
    typeof deploymentId !== 'string' ||
    typeof guestImageVersion !== 'string' ||
    typeof hostBootId !== 'string' ||
    typeof slot !== 'number'
  ) {
    return Option.none();
  }
  return Option.some({ deploymentId, guestImageVersion, hostBootId, slot });
}

/** Why a stored stamp is not the one a restore would need, or `undefined` when it is. */
export function driftFrom({
  stored,
  expected,
}: {
  stored: SnapshotStamp;
  expected: SnapshotStamp;
}): string | undefined {
  return DRIFT.find(([field]) => stored[field] !== expected[field])?.[1];
}

/**
 * Read rather than remembered, so a stamp is compared against the host as it is now. Failing
 * where the file is absent is the point: an unknown boot id that compared equal to another
 * unknown one would let a snapshot survive the reboot it exists to be invalidated by.
 */
export const readHostBootId = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  Effect.map(fs.readFileString(HOST_BOOT_ID_PATH), (value) => value.trim()),
);

/**
 * That the snapshot beside this stamp describes the restore being asked for. A snapshot that
 * fails here is one nothing may ever load, which is why the caller discards it rather than
 * leaving it for a later start to find and take as an instruction.
 */
export const ensureLoadable = Effect.fn('snapshot.ensureLoadable')(function* ({
  stampPath,
  expected,
}: {
  stampPath: string;
  expected: SnapshotStamp;
}) {
  const stored = Option.flatMap(yield* readJsonFile(stampPath), readStamp);
  if (Option.isNone(stored)) {
    return yield* new SnapshotUnusable({ reason: 'this host kept none' });
  }
  const drift = driftFrom({ stored: stored.value, expected });
  if (drift !== undefined) {
    return yield* new SnapshotUnusable({ reason: drift });
  }
});
