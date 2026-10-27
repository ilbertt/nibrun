import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { FileSystem } from '@effect/platform';
import type { VolumeId } from '@repo/protocol';
import { Data, Duration, Effect, Option, Schedule } from 'effect';
import { run, stdoutOf } from '#services/command-runner.service.ts';

export const NBD_CLIENT = 'nbd-client';

const NBD_CONNECTIONS = 4;
const NBD_BLOCK_SIZE_BYTES = 4096;
/**
 * S3 round trips under load turn a short timeout into an EIO the guest's ext4 answers by
 * remounting read-only.
 *
 * It is also the only ceiling anything on this host has over a dead export. A request the kernel
 * has accepted cannot be taken back by a signal — the process waiting on it sleeps
 * uninterruptibly, past SIGKILL and past systemd — so this number, and not any timeout in
 * userspace, is what eventually frees a waiter. Nothing below waits on one, which is what lets
 * this stay long enough to be safe for the guest.
 */
const NBD_TIMEOUT_SECONDS = 600;

const SYSFS_BLOCK_DIRECTORY = '/sys/block';
const NBD_DEVICE_NAME = /^nbd(?:0|[1-9]\d*)$/;
/** The unit the kernel publishes capacity in, whatever logical block size the device negotiated. */
const SYSFS_SECTOR_BYTES = 512;

/**
 * The kernel's own record of a device, which is the only part of it that answers while its server
 * does not.
 *
 * Opening `/dev/nbdN` is what blocks: a ZeroFS restart leaves the kernel holding a device whose
 * socket is gone, and every read queues behind requests that will not complete until the timeout
 * above. `blockdev --getsize64` on such a device sits in uninterruptible sleep for as long as
 * that takes, and no signal shortens it. These files are ordinary sysfs attributes on the gendisk
 * — they are answered from memory and cannot queue behind anything.
 */
const readAttribute = ({ devicePath, attribute }: { devicePath: string; attribute: string }) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(`${SYSFS_BLOCK_DIRECTORY}/${basename(devicePath)}/${attribute}`),
  );

/**
 * Whether a device has a client, which is a different question from whether it has a working one.
 * Kept because a detach is only worth attempting against a device somebody is holding.
 *
 * The kernel creates `pid` when a client takes the device and removes it when one lets go, so the
 * file being there is the whole answer. It is the same file `nbd-client -check` reads, reached
 * without a process this host would then have to be able to kill.
 */
export const isAttached = (devicePath: string) =>
  readAttribute({ devicePath, attribute: 'pid' }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

/** One block, at the offset every filesystem on the device keeps something at. */
const PROBE_BYTES = 4096;
const READ_SUCCEEDED = 0;
const NO_BYTES = 0;

/**
 * A dead device answers instantly and a live one answers from cache, so this bounds the case
 * neither covers: a server that is up but reaching S3 for the block. Shorter than the ceiling on
 * the device itself, because a probe that waited that long would hold the reconcile behind it.
 */
const PROBE_TIMEOUT_SECONDS = 15;
const PROBE_TIMEOUT = Duration.seconds(PROBE_TIMEOUT_SECONDS);

/**
 * Whether the device answers, which is what the kernel's own record of it does not say.
 *
 * A ZeroFS restart leaves the kernel holding a device that reports its size and names its client
 * and fails every read: sysfs is right about both, and the guest's ext4 cannot read its own
 * superblock. Observed on a live host, on both ZeroFS versions, so it is the reconnect and not
 * the release. Liveness has to be a read, because a read is the thing that is broken.
 *
 * `iflag=direct` is what makes it a read of the device rather than of the page cache. Without it
 * the host answers out of memory for a device that has been dead for hours, which is the same
 * false yes this replaces.
 *
 * The size is checked first, and it is not belt-and-braces. A detached nbd device is zero bytes
 * long, and reading one block of a zero-length device is not an error: `dd` reports `0+0 records
 * in` and exits 0. Asking only whether the read succeeded therefore answers yes for a device that
 * is not attached at all — which is every device on a host that has just rebooted, and a host
 * whose volumes are then never attached because nothing believes anything is wrong with them.
 *
 * Doing it from sysfs is what keeps the common case off the device: a host whose volumes are
 * detached spawns nothing at all, and only a device the kernel says is carrying data is ever
 * opened.
 */
export const isUsable = (devicePath: string) =>
  Effect.gen(function* () {
    const size = yield* attachedSizeBytes(devicePath);
    if (size <= NO_BYTES) {
      return false;
    }
    return yield* readsFirstBlock(devicePath);
  });

/**
 * Zero for a device nothing is attached to, which is the state a reboot leaves every one of them
 * in — and the state `nbd-client -d` puts one back into, so a device this host has given up on
 * stops being probed from the pass after it gave up.
 */
const attachedSizeBytes = (devicePath: string) =>
  readAttribute({ devicePath, attribute: 'size' }).pipe(
    Effect.map((sectors) => Number.parseInt(sectors.trim(), 10) * SYSFS_SECTOR_BYTES),
    Effect.map((size) => (Number.isFinite(size) ? size : NO_BYTES)),
    Effect.orElseSucceed(() => NO_BYTES),
  );

/**
 * The one thing here that opens the device, and so the one thing that can be left behind.
 *
 * `CommandRunner` gives up on the process rather than waiting for it to die, so a `dd` the kernel
 * will not let go of stops being this agent's problem the moment the timeout fires. What bounds
 * the ones left behind is the repair the `false` triggers: a device judged unusable is
 * reattached, and the `nbd-client -d` that starts the reattach errors every queued request on
 * that device, which frees the `dd` waiting on one. After that its size reads zero and nothing
 * probes it again until an attach succeeds — so the count is bounded by the devices on the host,
 * not by how often the reconcile runs.
 */
const readsFirstBlock = (devicePath: string) =>
  run({
    command: [
      'dd',
      `if=${devicePath}`,
      'of=/dev/null',
      `bs=${PROBE_BYTES}`,
      'count=1',
      'iflag=direct',
    ],
    timeout: PROBE_TIMEOUT,
  }).pipe(
    Effect.map((result) => result.code === READ_SUCCEEDED),
    // A probe that could not be run is not evidence the device is well, and the repair it leads
    // to costs a detach and an attach against a device nobody is using yet.
    Effect.catchAll(() => Effect.succeed(false)),
  );

function connect({
  client,
  ...target
}: Parameters<typeof connectionArguments>[0] & { client: string }) {
  return stdoutOf({ command: [client, ...connectionArguments(target)] });
}

function connectionArguments({
  socketPath,
  devicePath,
  volumeId,
  extraArgs,
}: {
  socketPath: string;
  devicePath: string;
  volumeId: VolumeId;
  extraArgs: readonly string[];
}) {
  return [
    '-unix',
    socketPath,
    devicePath,
    '-N',
    volumeId,
    ...extraArgs,
    '-timeout',
    String(NBD_TIMEOUT_SECONDS),
    '-connections',
    String(NBD_CONNECTIONS),
    '-block-size',
    String(NBD_BLOCK_SIZE_BYTES),
  ];
}

/**
 * `-persist` reconnects on its own, and it is kept for the drops it does cover — a socket that
 * goes and comes back while the kernel still has the device. It does not cover a ZeroFS restart:
 * the kernel tears the device down first, and what reconnects onto it reads as attached and
 * answers every read with an error. `isUsable` is what notices that, and `reattach` is what
 * repairs it.
 */
export const attach = Effect.fn('nbd.attach')(
  (target: { socketPath: string; devicePath: string; volumeId: VolumeId }) =>
    connect({ ...target, client: NBD_CLIENT, extraArgs: ['-persist'] }),
);

/**
 * A checkpoint server, which is a different kind of peer from the one behind a tenant's disk.
 *
 * No `-persist`: the server is started for one export and stopped after it, so one that died
 * mid-read is not coming back, and reconnecting forever would turn that into a dump that hangs
 * until its own ceiling instead of an export that says what went wrong. No guest is attached
 * here either, so there is no ext4 to remount read-only while it waits.
 *
 * Nothing asks for read-only. A checkpoint server is always read-only, so it advertises the
 * export that way and the kernel marks the device — which holds whether or not this side
 * remembered to ask, unlike a flag.
 */
export const attachCheckpoint = Effect.fn('nbd.attachCheckpoint')(
  (target: { socketPath: string; devicePath: string; volumeId: VolumeId }) =>
    connect({ ...target, client: NBD_CLIENT, extraArgs: [] }),
);

/**
 * Two ioctls on a device somebody already has open, which is why this works where a read does
 * not: `NBD_DISCONNECT` and `NBD_CLEAR_SOCK` error every request the kernel is holding rather
 * than joining the queue behind them. It is what frees a process sleeping on a dead device, and
 * the reason a wedged host recovers instead of waiting out the request timeout.
 */
export const detach = Effect.fn('nbd.detach')((devicePath: string) =>
  run({ command: [NBD_CLIENT, '-d', devicePath] }),
);

/**
 * Takes the device down before bringing it up, because the failure this repairs is a device the
 * kernel still holds. Attaching over it would find the minor busy; only a detach frees it.
 *
 * The detach is allowed to fail: the same call has to serve a device nobody has ever attached,
 * where there is nothing to take down and `-d` says so.
 */
export const reattach = Effect.fn('nbd.reattach')(function* (target: {
  socketPath: string;
  devicePath: string;
  volumeId: VolumeId;
}) {
  if (yield* isAttached(target.devicePath)) {
    yield* Effect.ignore(detach(target.devicePath));
  }
  return yield* attach(target);
});

export class NbdAttachmentMismatch extends Data.TaggedError('NbdAttachmentMismatch') {
  override get message() {
    return 'The block device is attached to a different or unidentified filesystem.';
  }
}

export class NbdAttachmentUnavailable extends Data.TaggedError('NbdAttachmentUnavailable') {
  override get message() {
    return 'The requested block device attachment is unavailable.';
  }
}

export function existingNbdDevices() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const devices = new Set<string>();
    for (const name of yield* fs.readDirectory(SYSFS_BLOCK_DIRECTORY)) {
      if (!NBD_DEVICE_NAME.test(name)) {
        continue;
      }
      const devicePath = `/dev/${name}`;
      const info = yield* fs
        .stat(devicePath)
        .pipe(
          Effect.catchTag('SystemError', (error) =>
            error.reason === 'NotFound' ? Effect.succeed(undefined) : Effect.fail(error),
          ),
        );
      if (info?.type === 'BlockDevice') {
        devices.add(devicePath);
      }
    }
    return devices;
  }).pipe(Effect.mapError(() => new NbdAttachmentUnavailable()));
}

export function attachmentScope(target: Parameters<typeof attach>[0]): string {
  const identity = JSON.stringify([target.socketPath, target.volumeId, target.devicePath]);
  return `nibrun-app-nbd-${createHash('sha256').update(identity).digest('hex')}.scope`;
}

export function attachmentLock(target: Parameters<typeof attach>[0]): string {
  return `/run/nibrun-nbd/${basename(target.devicePath)}.lock`;
}

function scopeExists(target: Parameters<typeof attach>[0]) {
  return Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.exists(`/sys/fs/cgroup/system.slice/${attachmentScope(target)}`),
  );
}

function privateArguments(target: Parameters<typeof attach>[0]) {
  return connectionArguments({ ...target, extraArgs: ['-persist', '-nonetlink'] });
}

function matchesProcess({
  target,
  cmdline,
  cgroup,
}: {
  target: Parameters<typeof attach>[0];
  cmdline: string;
  cgroup: string;
}) {
  const actual = cmdline.split('\0').slice(1, -1);
  const expected = privateArguments(target);
  const scopePath = `/system.slice/${attachmentScope(target)}`;
  return (
    cmdline.endsWith('\0') &&
    isDeepStrictEqual(actual, expected) &&
    cgroup.split('\n').some((line) => {
      return line === `0::${scopePath}`;
    })
  );
}

function attachmentAttribute(input: Parameters<typeof readAttribute>[0]) {
  return readAttribute(input).pipe(
    Effect.map((value) => Option.some(value.trim())),
    Effect.catchTag('SystemError', (error) =>
      error.reason === 'NotFound' ? Effect.succeedNone : Effect.fail(error),
    ),
    Effect.mapError(() => new NbdAttachmentUnavailable()),
  );
}

/** Requires exclusive device ownership and stopped guest writes; does not establish export identity. */
export function detachAndWaitForDisconnect(devicePath: string) {
  return Effect.gen(function* () {
    const name = basename(devicePath);
    if (devicePath !== `/dev/${name}` || !NBD_DEVICE_NAME.test(name)) {
      return yield* new NbdAttachmentUnavailable();
    }
    const fs = yield* FileSystem.FileSystem;
    const [device, kernel] = yield* Effect.all([
      fs.stat(devicePath),
      fs.stat(`${SYSFS_BLOCK_DIRECTORY}/${name}`),
    ]);
    if (device.type !== 'BlockDevice' || kernel.type !== 'Directory') {
      return yield* new NbdAttachmentUnavailable();
    }
    const attribute = { devicePath, attribute: 'pid' };
    const pid = yield* attachmentAttribute(attribute);
    if (Option.isNone(pid)) {
      return;
    }
    if (!/^[1-9]\d*$/.test(pid.value) || (yield* detach(devicePath)).code !== 0) {
      return yield* new NbdAttachmentUnavailable();
    }
    yield* attachmentAttribute(attribute).pipe(
      Effect.repeat({
        schedule: Schedule.spaced('50 millis'),
        until: Option.isNone,
      }),
      Effect.timeoutFail({
        duration: '2 seconds',
        onTimeout: () => new NbdAttachmentUnavailable(),
      }),
    );
  }).pipe(
    Effect.mapError(() => new NbdAttachmentUnavailable()),
    Effect.asVoid,
  );
}

export function inspectAttachment(target: Parameters<typeof attach>[0]) {
  return Effect.gen(function* () {
    const [pid, backend] = yield* Effect.all([
      attachmentAttribute({ devicePath: target.devicePath, attribute: 'pid' }),
      attachmentAttribute({ devicePath: target.devicePath, attribute: 'backend' }),
    ]);
    // Netlink setup PIDs can outlive the process and be reused; only ioctl owners stay blocked.
    if (Option.isSome(backend)) {
      return yield* new NbdAttachmentMismatch();
    }
    if (Option.isNone(pid)) {
      return false;
    }
    if (!/^[1-9]\d*$/.test(pid.value)) {
      return yield* new NbdAttachmentUnavailable();
    }
    const fs = yield* FileSystem.FileSystem;
    const [cmdline, cgroup] = yield* Effect.all([
      fs.readFileString(`/proc/${pid.value}/cmdline`),
      fs.readFileString(`/proc/${pid.value}/cgroup`),
    ]).pipe(
      Effect.mapError((error) =>
        error._tag === 'SystemError' && error.reason === 'NotFound'
          ? new NbdAttachmentMismatch()
          : new NbdAttachmentUnavailable(),
      ),
    );
    if (!matchesProcess({ target, cmdline, cgroup })) {
      return yield* new NbdAttachmentMismatch();
    }
    const current = yield* attachmentAttribute({ devicePath: target.devicePath, attribute: 'pid' });
    if (Option.isNone(current) || current.value !== pid.value) {
      return yield* new NbdAttachmentMismatch();
    }
    return true;
  });
}

export function isUsableFor(target: Parameters<typeof attach>[0]) {
  return inspectAttachment(target).pipe(
    Effect.flatMap((matched) => (matched ? isUsable(target.devicePath) : Effect.succeed(false))),
    Effect.orElseSucceed(() => false),
  );
}

export function detachVerified(target: Parameters<typeof attach>[0]) {
  return Effect.gen(function* () {
    const attached = yield* inspectAttachment(target);
    if (attached || (yield* scopeExists(target))) {
      // Stop also waits for the old daemon's cleanup before another client can reuse the device.
      yield* stdoutOf({ command: ['systemctl', 'stop', attachmentScope(target)] }).pipe(
        Effect.catchAll(() =>
          Effect.gen(function* () {
            if ((yield* scopeExists(target)) || (yield* inspectAttachment(target))) {
              return yield* new NbdAttachmentUnavailable();
            }
          }),
        ),
      );
    }
    yield* attachmentAttribute({ devicePath: target.devicePath, attribute: 'pid' }).pipe(
      Effect.filterOrFail(Option.isNone, () => new NbdAttachmentUnavailable()),
      Effect.retry(Schedule.spaced('50 millis').pipe(Schedule.upTo('2 seconds'))),
    );
  }).pipe(
    Effect.mapError((error) =>
      error._tag === 'NbdAttachmentMismatch' ? error : new NbdAttachmentUnavailable(),
    ),
  );
}

export function reattachVerified(
  target: Parameters<typeof detachVerified>[0] & { client: string },
) {
  return Effect.gen(function* () {
    yield* detachVerified(target);
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .makeDirectory(dirname(attachmentLock(target)), { recursive: true, mode: 0o700 })
      .pipe(Effect.mapError(() => new NbdAttachmentUnavailable()));
    // A separate scope keeps the ioctl owner alive when the agent's service restarts.
    // The inherited lock excludes another setup even before the kernel publishes the owner PID.
    yield* stdoutOf({
      command: [
        'flock',
        '--exclusive',
        '--nonblock',
        '--no-fork',
        attachmentLock(target),
        'systemd-run',
        '--scope',
        '--quiet',
        '--collect',
        '--slice=system.slice',
        `--unit=${attachmentScope(target)}`,
        '--',
        target.client,
        ...privateArguments(target),
      ],
    }).pipe(Effect.mapError(() => new NbdAttachmentUnavailable()));
    // The client daemonizes before entering NBD_DO_IT and publishing its kernel PID.
    yield* inspectAttachment(target).pipe(
      Effect.flatMap((attached) =>
        attached ? isUsable(target.devicePath) : Effect.succeed(false),
      ),
      Effect.filterOrFail(
        (attached) => attached,
        () => new NbdAttachmentUnavailable(),
      ),
      Effect.retry({
        while: (error) => error._tag === 'NbdAttachmentUnavailable',
        schedule: Schedule.spaced('50 millis').pipe(Schedule.upTo('2 seconds')),
      }),
    );
  });
}
