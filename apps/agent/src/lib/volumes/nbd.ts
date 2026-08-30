import type { VolumeId } from '@repo/protocol';
import { Duration, Effect } from 'effect';
import { run, stdoutOf } from '#services/command-runner.service.ts';

const NBD_CLIENT = 'nbd-client';
const CONNECTED_EXIT_CODE = 0;

const NBD_CONNECTIONS = 4;
const NBD_BLOCK_SIZE_BYTES = 4096;
/** S3 round trips under load turn a short timeout into an EIO the guest's ext4 answers by
 * remounting read-only. */
const NBD_TIMEOUT_SECONDS = 600;

/**
 * Whether a device has a client, which is a different question from whether it has a working one.
 * Kept because a detach is only worth attempting against a device somebody is holding.
 */
export const isAttached = (devicePath: string) =>
  Effect.map(
    run({ command: [NBD_CLIENT, '-check', devicePath] }),
    (result) => result.code === CONNECTED_EXIT_CODE,
  );

/** One block, at the offset every filesystem on the device keeps something at. */
const PROBE_BYTES = 4096;

/**
 * A dead device answers instantly and a live one answers from cache, so this bounds the case
 * neither covers: a server that is up but reaching S3 for the block. Shorter than the ceiling on
 * the device itself, because a probe that waited that long would hold the reconcile behind it.
 */
const PROBE_TIMEOUT_SECONDS = 15;
const PROBE_TIMEOUT = Duration.seconds(PROBE_TIMEOUT_SECONDS);

/**
 * Whether the device answers, which is what `-check` does not ask.
 *
 * A ZeroFS restart leaves the kernel holding a device that reports its size and names its client
 * and fails every read: `-check` exits 0, `blockdev --getsize64` is right, and the guest's ext4
 * cannot read its own superblock. Observed on a live host, on both ZeroFS versions, so it is the
 * reconnect and not the release. Liveness has to be a read, because a read is the thing that is
 * broken.
 *
 * `iflag=direct` is what makes it a read of the device rather than of the page cache. Without it
 * the host answers out of memory for a device that has been dead for hours, which is the same
 * false yes this replaces.
 */
export const isUsable = (devicePath: string) =>
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
    Effect.map((result) => result.code === CONNECTED_EXIT_CODE),
    // A probe that could not be run is not evidence the device is well, and the repair it leads
    // to costs a detach and an attach against a device nobody is using yet.
    Effect.catchAll(() => Effect.succeed(false)),
  );

const connect = ({
  socketPath,
  devicePath,
  volumeId,
  extraArgs,
}: {
  socketPath: string;
  devicePath: string;
  volumeId: VolumeId;
  extraArgs: readonly string[];
}) =>
  stdoutOf({
    command: [
      NBD_CLIENT,
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
    ],
  });

/**
 * `-persist` reconnects on its own, and it is kept for the drops it does cover — a socket that
 * goes and comes back while the kernel still has the device. It does not cover a ZeroFS restart:
 * the kernel tears the device down first, and what reconnects onto it reads as attached and
 * answers every read with an error. `isUsable` is what notices that, and `reattach` is what
 * repairs it.
 */
export const attach = Effect.fn('nbd.attach')(
  (target: { socketPath: string; devicePath: string; volumeId: VolumeId }) =>
    connect({ ...target, extraArgs: ['-persist'] }),
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
    connect({ ...target, extraArgs: [] }),
);

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
