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

/**
 * What the disk a snapshot goes on has to keep free for everything on it that is not one: a
 * checkpoint server's four gigabytes while an export reads
 * (`infra/app-host/zerofs/checkpoint.toml`), and slack for a filesystem nobody wants at 100%.
 *
 * Snapshots are the only consumer of that disk with a number to obey, so this is where the others
 * get their room. It is held free *beyond* ZeroFS's configured cache rather than out of it —
 * running out of instance store breaks ZeroFS, and ZeroFS is every app's disk on the host,
 * sleeping or not.
 */
const DISK_RESERVE_GIB = 8;

const BYTES_PER_MIB = 1_048_576;
const BYTES_PER_GIB = 1_073_741_824;
const DISK_RESERVE_BYTES = DISK_RESERVE_GIB * BYTES_PER_GIB;
const GIB_DECIMALS = 1;
const NONE = 0;

/** The disk `snapshotDir` is on, as the decision to write another snapshot to it needs it. */
export type SnapshotDisk = {
  readonly totalBytes: number;
  readonly availableBytes: number;
  /** What ZeroFS may cache here, which is disk it has not taken yet rather than disk it is using. */
  readonly zerofsCacheBytes: number;
  /** What the snapshots already here hold. */
  readonly snapshotBytes: number;
};

/** A memory file is exactly the guest's RAM. The vmstate beside it is kilobytes, and is slack. */
export function snapshotBytesFor(memoryMib: number): number {
  return memoryMib * BYTES_PER_MIB;
}

/** All the disk snapshots may ever hold together, floored at none for a host with no room at all. */
export function snapshotBudget(disk: SnapshotDisk): number {
  return Math.max(disk.totalBytes - disk.zerofsCacheBytes - DISK_RESERVE_BYTES, NONE);
}

function gibibytes(bytes: number): string {
  return `${(bytes / BYTES_PER_GIB).toFixed(GIB_DECIMALS)} GiB`;
}

/**
 * Why this host will not keep another snapshot, or `undefined` when it will.
 *
 * A snapshot is the size of the app's configured memory rather than of the default, so a host
 * carrying a few multi-gigabyte apps runs out of instance store on its own. What that costs is
 * not the sleeping apps: `/data` is where ZeroFS caches, and ZeroFS is the disk **every** app on
 * the host is running from. A cost optimisation nobody opted into would be taking down apps that
 * never sleep — so the two bounds below are what stands between it and them, and a refusal here
 * costs one app one cold start it was not going to take anyway.
 *
 * Both bounds are needed and neither implies the other. The budget is against the disk's *size*,
 * because ZeroFS fills its cache lazily: free space on a fresh host is space already promised.
 * The floor is against what is *actually* free, because the promise is not the only claim — a
 * checkpoint server's cache, an overshoot, anything else that arrived on this disk — and at the
 * moment those have eaten it, adding a snapshot is the thing that must not happen.
 */
export function refusalForDisk({
  disk,
  wantedBytes,
}: {
  disk: SnapshotDisk;
  wantedBytes: number;
}): string | undefined {
  const budget = snapshotBudget(disk);
  if (disk.snapshotBytes + wantedBytes > budget) {
    return `snapshots on this host may hold ${gibibytes(budget)} and already hold ${gibibytes(disk.snapshotBytes)}`;
  }
  if (disk.availableBytes - wantedBytes < DISK_RESERVE_BYTES) {
    return `the disk it would be written to has ${gibibytes(disk.availableBytes)} left, which the filesystem every app runs from needs more than it does`;
  }
  return undefined;
}

/**
 * What the snapshots on this host hold, measured rather than derived from the agent's own record
 * of which apps are asleep: one an earlier agent left behind occupies the same disk as one this
 * agent wrote, and the disk is what is running out.
 */
export const readSnapshotBytes = Effect.fn('snapshot.readSnapshotBytes')(function* (
  snapshotDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs.readDirectory(snapshotDir, { recursive: true });
  let held = NONE;
  for (const entry of entries) {
    held += yield* fileBytes(join(snapshotDir, entry));
  }
  return held;
});

/** A file gone between the listing and the stat is a snapshot being discarded — disk given back. */
function fileBytes(path: string) {
  return FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.stat(path)),
    Effect.map((info) => (info.type === 'File' ? Number(info.size) : NONE)),
    Effect.orElseSucceed(() => NONE),
  );
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
