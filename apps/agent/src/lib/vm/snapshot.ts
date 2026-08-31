import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import type { AppId, DeploymentId } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { readJsonFile } from '#lib/json-store.ts';

export const SNAPSHOT_STATE_FILENAME = 'vmstate';
export const SNAPSHOT_MEMORY_FILENAME = 'memory';

/**
 * Written last and consumed first, which is what makes a restore happen **at most once**: the
 * agent writes it only once the two files beside it are complete, and `vm_launch.sh` deletes it
 * before it execs the Firecracker that will load them. A start that finds no stamp is a cold boot
 * — so an agent that died between the load and the cleanup leaves a microVM that boots off its
 * disk rather than one that resumes from a snapshot the disk has since moved past.
 *
 * **At most once is a security invariant and not only a crash-safety one.** The guest kernel is
 * built with `CONFIG_VMGENID=y`, so Firecracker updates the generation id and injects its
 * interrupt before vCPUs resume, and Linux reseeds the kernel CRNG off it — `getrandom()` and
 * `/dev/urandom` are fresh on the far side of a wake. Nothing reseeds the PRNG state already
 * resident in tenant memory: OpenSSL's `RAND` buffer, a runtime's per-thread generator, a nonce
 * already drawn. One snapshot restored twice is therefore the same randomness in two live VMs,
 * which is key reuse with no symptom to notice it by. That is what is being traded away by
 * anyone who makes a snapshot into a reusable warm-start template, and it is a trade to make
 * deliberately rather than to discover.
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

export class SleepRefused extends Data.TaggedError('SleepRefused')<{
  readonly reason: string;
}> {
  override get message() {
    return `this microVM must not be snapshotted: ${this.reason}`;
  }
}

/**
 * The two moments a microVM survives being snapshotted and its tenant does not survive being
 * woken. Enforced here rather than left to whatever decides an app should sleep, because a
 * policy is the thing that changes: the obvious next idea is to snapshot an app right after
 * creating it to make cold starts cheap, and that idea has to fail here rather than in
 * production.
 *
 * **A stop already in flight.** `clock_realtime` advances the clocksource rather than applying a
 * wall-clock offset, so `CLOCK_MONOTONIC` moves forward with it. The SIGTERM-to-SIGKILL deadline
 * the guest's supervisor holds in `PHASE_TERM_SENT` (`apps/runtime/src/supervise.c`) is a
 * monotonic instant, so it lands in the past on the first poll after a wake and the tenant is
 * killed for a shutdown it was in the middle of handling gracefully.
 *
 * **A guest that has not finished booting.** Firecracker injects the VMGenID interrupt before
 * vCPUs resume, and a kernel snapshotted before its interrupt handling was in place can crash
 * taking it. This guest boots with `panic=1 reboot=k` and `CONFIG_PANIC_ON_OOPS=y`, so that
 * crash is the end of the microVM rather than a line on its console. `everHealthy` is the bar
 * because it is the host's only first-hand evidence: the tenant accepted a connection, which is
 * far past the window that is dangerous, and it stays true for a guest that has since gone
 * unhealthy — being unwell is not the same as never having booted.
 */
export function refusalToSleep(
  subject:
    | {
        readonly stopRequested: boolean;
        readonly desiredRunning: boolean;
        readonly everHealthy: boolean;
      }
    | undefined,
): string | undefined {
  if (subject === undefined) {
    return 'this host holds no record of it';
  }
  if (subject.stopRequested || !subject.desiredRunning) {
    return 'it has already been asked to stop';
  }
  if (!subject.everHealthy) {
    return 'it has never answered, so it may not have finished booting';
  }
  return undefined;
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
