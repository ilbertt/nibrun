import { FileSystem, Path } from '@effect/platform';
import type { AppId, DeploymentId, DesiredInstance } from '@repo/protocol';
import { Duration, Effect, Either } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import { tenantLogSocketPath } from '#lib/logs/vsock.ts';
import type { AppSlot } from '#lib/network/slot.ts';
import { ensureTap, refreshNeighbour } from '#lib/network/tap.ts';
import { readFilesystemSpace } from '#lib/report/capacity.ts';
import { readHostVersions } from '#lib/report/versions.ts';
import * as Artifacts from '#lib/vm/artifacts.ts';
import * as Firecracker from '#lib/vm/firecracker-api.ts';
import { renderFirecrackerConfig } from '#lib/vm/firecracker-config.ts';
import { buildInstanceConfigImage } from '#lib/vm/instance-env.ts';
import {
  ensureLoadable,
  readHostBootId,
  readSnapshotBytes,
  refusalForDisk,
  refusalToSleep,
  SleepRefused,
  type SnapshotDisk,
  type SnapshotStamp,
  snapshotBudget,
  snapshotBytesFor,
  snapshotPaths,
} from '#lib/vm/snapshot.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { GUEST_VSOCK_FILENAME, vmWorkingDir } from '#lib/vm/vsock.ts';
import { readCacheDiskBytes } from '#lib/volumes/zerofs.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

export const FIRECRACKER_CONFIG_FILENAME = 'firecracker.json';
export const GUEST_KERNEL_FILENAME = 'vmlinux';
export const GUEST_ROOTFS_FILENAME = 'rootfs.ext4';

const VM_DIR_MODE = 0o700;
const FIRST_GUEST_CID = 3;

/** What both halves of a suspend need to name the microVM they are acting on. */
type SuspendRequest = {
  readonly appId: AppId;
  readonly deploymentId: DeploymentId;
  readonly slot: AppSlot;
};

export class VmManager extends Effect.Service<VmManager>()('VmManager', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const logs = yield* TenantLogReceiver;
    const zerofs = yield* ZerofsTopology;
    const agentState = yield* AgentState;

    const workingDir = (appId: AppId) => vmWorkingDir({ vmDir: config.vmDir, appId });
    function snapshotFor(appId: AppId) {
      return snapshotPaths({ snapshotDir: config.vmSnapshotDir, appId });
    }
    function apiSocket(appId: AppId) {
      return Systemd.vmApiSocketPath({ runtimeDir: config.runtimeDir, appId });
    }

    /**
     * The stamp a snapshot taken now would carry, and the one a stored snapshot has to match to
     * be loadable. Both readings are of the host as it is at this moment rather than as it was
     * when the agent started, because a deploy moves the guest image under a running agent.
     */
    const currentStamp = Effect.fn('VmManager.currentStamp')(function* ({
      deploymentId,
      slot,
    }: Omit<SuspendRequest, 'appId'>) {
      const versions = yield* readHostVersions(config.versionsFile);
      return {
        deploymentId,
        guestImageVersion: versions.guestImage,
        hostBootId: yield* readHostBootId,
        slot: slot.slot,
      } satisfies SnapshotStamp;
    });

    /**
     * The stamp first and on its own: while it is there a start takes the snapshot beside it as
     * an instruction, and once it is gone none of what remains is loadable by anything.
     */
    const discardSnapshot = Effect.fn('VmManager.discardSnapshot')(function* (appId: AppId) {
      const paths = snapshotFor(appId);
      yield* fs.remove(paths.stampPath, { force: true });
      yield* fs.remove(paths.directory, { recursive: true, force: true });
    });

    /** Where the caller has a failure of its own to report and a leaked snapshot is the lesser one. */
    function forgetSnapshot(appId: AppId) {
      return discardSnapshot(appId).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning('snapshot could not be discarded', error).pipe(
            Effect.annotateLogs({ appId }),
          ),
        ),
      );
    }

    /**
     * Everything a cold boot puts on disk and in the kernel before the VMM is asked for anything:
     * the tap, the host's view of the guest behind it, the config drive and the machine
     * description Firecracker reads.
     *
     * Apart from the start it precedes because the two are paid by different things. This is the
     * host's own work and shortening it is this end's to do; what follows is the guest's kernel
     * and the tenant's own startup, which is not.
     */
    const stage = Effect.fn('VmManager.stage')(function* ({
      desired,
      slot,
      dataDevicePath,
      artifactImagePath,
    }: {
      desired: DesiredInstance;
      slot: AppSlot;
      dataDevicePath: string;
      artifactImagePath: string;
    }) {
      yield* ensureTap({
        tapName: slot.tapName,
        hostIpv4: slot.hostIpv4,
        subnetPrefixLength: slot.subnetPrefixLength,
      });
      // Written before the guest exists rather than after it answers, because nothing has to ask
      // the guest for it: the MAC is the slot's, and the config below is what hands it over. Left
      // to ARP, the host's first probe of a new guest pays the resolution `refreshNeighbour`
      // documents — the same second a wake already knows not to spend.
      yield* refreshNeighbour({
        guestIpv4: slot.guestIpv4,
        guestMac: slot.guestMac,
        tapName: slot.tapName,
      });

      const directory = workingDir(desired.appId);
      yield* fs.makeDirectory(directory, { recursive: true, mode: VM_DIR_MODE });
      const instanceConfigImagePath = yield* buildInstanceConfigImage({
        workingDir: directory,
        httpPort: desired.config.httpPort,
        ...(desired.config.hasExtraPublicPort && {
          publicAddress: { ipv4: config.portRelayPublicIpv4, port: slot.extraPublicPort },
        }),
        hostnames: desired.hostnames,
        args: desired.config.args,
        environment: desired.config.environment,
        restartPolicy: desired.config.restartPolicy,
      });

      yield* writeJsonFile({
        path: path.join(directory, FIRECRACKER_CONFIG_FILENAME),
        value: renderFirecrackerConfig({
          resources: desired.config.resources,
          paths: {
            kernelPath: path.join(config.guestImageDir, GUEST_KERNEL_FILENAME),
            rootfsPath: path.join(config.guestImageDir, GUEST_ROOTFS_FILENAME),
            artifactImagePath,
            instanceConfigImagePath,
            dataDevicePath,
          },
          network: {
            tapName: slot.tapName,
            guestMac: slot.guestMac,
            guestIpv4: slot.guestIpv4,
            hostIpv4: slot.hostIpv4,
            subnetPrefixLength: slot.subnetPrefixLength,
          },
          vsock: {
            guestCid: FIRST_GUEST_CID + slot.slot,
            path: GUEST_VSOCK_FILENAME,
          },
        }),
      });

      yield* logs.attach({
        source: {
          appId: desired.appId,
          deploymentId: desired.deploymentId,
        },
        socketPath: tenantLogSocketPath({ workingDir: directory }),
      });
    });

    /**
     * The agent never becomes the VM's parent: it stages the files, asks init to start the unit,
     * and stops caring.
     *
     * The three costs are timed apart because a cold start is the one thing here with no other
     * account of itself: what the control plane records is the whole of it, and a deploy that
     * grew by a second says nothing about which of these grew. `artifactMs` is nearly nothing
     * where the prefetch already built the image and the whole download where it did not, which
     * is the difference between a host that has seen these bytes and one that has not.
     */
    const boot = Effect.fn('VmManager.boot')(function* ({
      desired,
      slot,
      dataDevicePath,
    }: {
      desired: DesiredInstance;
      slot: AppSlot;
      dataDevicePath: string;
    }) {
      yield* Effect.annotateCurrentSpan({
        appId: desired.appId,
      });
      // Ahead of everything, because everything below replaces what a snapshot of this app was
      // taken against — and a start that still found a stamp would restore the old guest onto
      // the new deployment's disk rather than boot the new one.
      yield* discardSnapshot(desired.appId);
      const [fetching, artifactImagePath] = yield* Effect.timed(
        Artifacts.ensureArtifactImage(desired.artifact),
      );
      const [staging] = yield* Effect.timed(
        stage({ desired, slot, dataDevicePath, artifactImagePath }),
      );
      const [starting] = yield* Effect.timed(
        Effect.onError(Systemd.start(desired.appId), () =>
          Effect.ignore(logs.detach(desired.appId)),
        ),
      );
      yield* Effect.logInfo('instance booting').pipe(
        Effect.annotateLogs({
          appId: desired.appId,
          slot: slot.slot,
          artifactMs: Duration.toMillis(fetching),
          stagedMs: Duration.toMillis(staging),
          vmmMs: Duration.toMillis(starting),
        }),
      );
    });

    /**
     * The disk this host's snapshots are on, as the decision to write another one needs it. The
     * directory is made first so a host that has never slept an app still measures the instance
     * store rather than failing to stat a path that is not there yet.
     */
    const readSnapshotDisk = Effect.fn('VmManager.readSnapshotDisk')(function* () {
      yield* fs.makeDirectory(config.vmSnapshotDir, { recursive: true, mode: VM_DIR_MODE });
      const space = yield* readFilesystemSpace(config.vmSnapshotDir);
      return {
        ...space,
        zerofsCacheBytes: yield* readCacheDiskBytes(config.zerofsConfigFile),
        snapshotBytes: yield* readSnapshotBytes(config.vmSnapshotDir),
      } satisfies SnapshotDisk;
    });

    /**
     * Every reason this microVM must not be snapshotted now, or `undefined`.
     *
     * The states a snapshot must never be taken in are read from this agent's own record of the
     * instance rather than accepted from the caller, because they are the preconditions of the
     * operation and not an opinion about it: a caller that could supply them could also forget
     * to. `refusalToSleep` is where each one is spelled out, and `refusalForDisk` is what keeps a
     * host's sleeping apps from filling the disk its running ones read and write through.
     *
     * A disk that cannot be measured refuses too. Sleeping is an optimisation and refusing it
     * costs an app nothing it notices, so every doubt here resolves the same way.
     */
    const refusalToSnapshot = Effect.fn('VmManager.refusalToSnapshot')(function* (appId: AppId) {
      const record = (yield* agentState.snapshot).records.get(appId);
      if (record === undefined) {
        return refusalToSleep(undefined);
      }
      const refusal = refusalToSleep({
        stopRequested: record.stopRequested,
        desiredRunning: record.desiredRunning,
        everHealthy: record.health.everHealthy,
      });
      if (refusal !== undefined) {
        return refusal;
      }
      const disk = yield* Effect.either(readSnapshotDisk());
      if (Either.isLeft(disk)) {
        yield* Effect.logWarning('snapshot disk could not be measured', disk.left).pipe(
          Effect.annotateLogs({ appId }),
        );
        return 'the disk it would be written to cannot be measured';
      }
      // The one place these numbers exist. Nothing else on the fleet can be asked what snapshots
      // are holding, so a sleep says it on the way past whether or not it is allowed to proceed.
      yield* Effect.logInfo('snapshot disk measured').pipe(
        Effect.annotateLogs({
          appId,
          ...disk.right,
          budgetBytes: snapshotBudget(disk.right),
        }),
      );
      return refusalForDisk({
        disk: disk.right,
        wantedBytes: snapshotBytesFor(record.resources.memoryMib),
      });
    });

    /**
     * A microVM taken down at a point it can be put back on, rather than one taken down.
     *
     * The flush comes before the pause on purpose: one that hangs then leaves a microVM that is
     * still serving, where a pause first would freeze the tenant for the whole of it. It is what
     * makes this a durability point at all — `ignore_fsync` has already made the guest's own
     * fsync a no-op — and it has to hold even for the snapshot that is later discarded, because
     * that app cold-boots off its disk and finds only what was flushed.
     *
     * The stamp is written last, once the microVM is down and the files beside it are complete.
     * Nothing before that point is loadable, which is what makes every way this can fail leave a
     * cold boot rather than a half-restore.
     */
    const sleep = Effect.fn('VmManager.sleep')(function* ({
      appId,
      deploymentId,
      slot,
    }: SuspendRequest) {
      yield* Effect.annotateCurrentSpan({ appId });
      const refusal = yield* refusalToSnapshot(appId);
      if (refusal !== undefined) {
        return yield* new SleepRefused({ reason: refusal });
      }

      const paths = snapshotFor(appId);
      const socketPath = apiSocket(appId);
      const stamp = yield* currentStamp({ deploymentId, slot });

      yield* discardSnapshot(appId);
      yield* fs.makeDirectory(paths.directory, { recursive: true, mode: VM_DIR_MODE });
      yield* zerofs.flushAll;

      // Timed as one window because it is one: the guest is stopped from the pause to the stop,
      // so this is what sleeping costs a tenant rather than what it costs the host.
      const [paused] = yield* Effect.timed(
        Effect.gen(function* () {
          yield* Firecracker.pause(socketPath);
          yield* Effect.onError(
            Effect.gen(function* () {
              yield* Firecracker.createSnapshot({
                socketPath,
                statePath: paths.statePath,
                memoryPath: paths.memoryPath,
              });
              yield* Systemd.stop(appId);
            }),
            // A microVM left paused answers nothing and is never asked to run again.
            () => Effect.ignore(Firecracker.resume(socketPath)),
          );
        }),
      );

      yield* writeJsonFile({ path: paths.stampPath, value: stamp });
      // `memoryBytes` beside the duration because the two move together — a snapshot is the
      // guest's whole RAM, so what this costs grows with what an app asked for and not with
      // anything the host can tune.
      const captured = yield* Effect.orElseSucceed(fs.stat(paths.memoryPath), () => undefined);
      yield* Effect.logInfo('instance asleep').pipe(
        Effect.annotateLogs({
          appId,
          slot: slot.slot,
          snapshotMs: Duration.toMillis(paused),
          ...(captured && { memoryBytes: Number(captured.size) }),
        }),
      );
    });

    /**
     * The microVM that went to sleep, back where it was.
     *
     * The stamp is checked before anything starts, and a snapshot that fails the check is thrown
     * away rather than left: it is unloadable from here on, and a stamp on disk is what a start
     * reads to decide it is a restore. The start itself consumes the stamp, so every way this can
     * fail past that point leaves the next start a cold boot.
     */
    const wake = Effect.fn('VmManager.wake')(function* ({
      appId,
      deploymentId,
      slot,
    }: SuspendRequest) {
      yield* Effect.annotateCurrentSpan({ appId });
      const paths = snapshotFor(appId);
      const socketPath = apiSocket(appId);
      const expected = yield* currentStamp({ deploymentId, slot });
      yield* Effect.onError(ensureLoadable({ stampPath: paths.stampPath, expected }), () =>
        forgetSnapshot(appId),
      );

      // From the start to the neighbour refresh, which is the whole of what the request that
      // caused this is waiting on — the stamp check above it happens before anything is asked
      // of the VMM and costs a file read.
      const [restoring] = yield* Effect.timed(
        Effect.gen(function* () {
          yield* Systemd.start(appId);
          yield* Effect.ensuring(
            Effect.onError(
              Effect.gen(function* () {
                yield* Firecracker.loadSnapshot({
                  socketPath,
                  statePath: paths.statePath,
                  memoryPath: paths.memoryPath,
                });
                yield* Firecracker.resume(socketPath);
                yield* refreshNeighbour({
                  guestIpv4: slot.guestIpv4,
                  guestMac: slot.guestMac,
                  tapName: slot.tapName,
                });
              }),
              // The start already consumed the stamp, so this Firecracker holds no guest and never
              // will: stopping it is what leaves a cold boot rather than a process in the way of one.
              () => Effect.ignore(Systemd.stop(appId)),
            ),
            // Every way out, so no retry of a restore that failed halfway can find the files it did
            // not finish with. The stamp is already gone and would stop a second load on its own;
            // this is what keeps at-most-once from resting on that single fact.
            //
            // Unlinking while Firecracker still has the memory file mapped keeps the mapping alive
            // and hands the disk back the moment the microVM exits, so the successful path pays
            // nothing for it either.
            forgetSnapshot(appId),
          );
        }),
      );
      yield* Effect.logInfo('instance awake').pipe(
        Effect.annotateLogs({ appId, slot: slot.slot, restoreMs: Duration.toMillis(restoring) }),
      );
    });

    return {
      workingDir,
      boot,
      sleep,
      wake,
      /** Before the stop, so a stop that fails leaves a running microVM and never a stale snapshot. */
      stop: Effect.fn('VmManager.stop')(function* (appId: AppId) {
        yield* discardSnapshot(appId);
        yield* Systemd.stop(appId);
      }),
      discard: Effect.fn('VmManager.discard')(function* (appId: AppId) {
        yield* Effect.annotateCurrentSpan({ appId });
        yield* discardSnapshot(appId);
        yield* Systemd.forget(appId);
        yield* logs.detach(appId);
        yield* fs.remove(workingDir(appId), { recursive: true, force: true });
      }),
    };
  }),
  dependencies: [
    AgentConfig.Default,
    AgentState.Default,
    TenantLogReceiver.Default,
    ZerofsTopology.Default,
  ],
}) {}
