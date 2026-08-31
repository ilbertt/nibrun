import { FileSystem, Path } from '@effect/platform';
import type { AppId, DeploymentId, DesiredInstance } from '@repo/protocol';
import { Effect } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import { tenantLogSocketPath } from '#lib/logs/vsock.ts';
import type { AppSlot } from '#lib/network/slot.ts';
import { ensureTap, refreshNeighbour } from '#lib/network/tap.ts';
import { readHostVersions } from '#lib/report/versions.ts';
import * as Artifacts from '#lib/vm/artifacts.ts';
import * as Firecracker from '#lib/vm/firecracker-api.ts';
import { renderFirecrackerConfig } from '#lib/vm/firecracker-config.ts';
import { buildInstanceConfigImage } from '#lib/vm/instance-env.ts';
import {
  ensureLoadable,
  readHostBootId,
  type SnapshotStamp,
  snapshotPaths,
} from '#lib/vm/snapshot.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { GUEST_VSOCK_FILENAME, vmWorkingDir } from '#lib/vm/vsock.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
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

    const workingDir = (appId: AppId) => vmWorkingDir({ vmDir: config.vmDir, appId });
    const snapshotFor = (appId: AppId) =>
      snapshotPaths({ snapshotDir: config.vmSnapshotDir, appId });
    const apiSocket = (appId: AppId) =>
      Systemd.vmApiSocketPath({ runtimeDir: config.runtimeDir, appId });

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

    /**
     * The agent never becomes the VM's parent: it stages the files, asks init to start the unit,
     * and stops caring.
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
      const artifactImagePath = yield* Artifacts.ensureArtifactImage(desired.artifact);
      yield* ensureTap({
        tapName: slot.tapName,
        hostIpv4: slot.hostIpv4,
        subnetPrefixLength: slot.subnetPrefixLength,
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
      yield* Effect.onError(Systemd.start(desired.appId), () =>
        Effect.ignore(logs.detach(desired.appId)),
      );
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
      const paths = snapshotFor(appId);
      const socketPath = apiSocket(appId);
      const stamp = yield* currentStamp({ deploymentId, slot });

      yield* discardSnapshot(appId);
      yield* fs.makeDirectory(paths.directory, { recursive: true, mode: VM_DIR_MODE });
      yield* zerofs.flushAll;

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

      yield* writeJsonFile({ path: paths.stampPath, value: stamp });
      yield* Effect.logInfo('instance asleep').pipe(
        Effect.annotateLogs({ appId, slot: slot.slot }),
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
        discardSnapshot(appId).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning('stale snapshot could not be discarded', error).pipe(
              Effect.annotateLogs({ appId }),
            ),
          ),
        ),
      );

      yield* Systemd.start(appId);
      yield* Effect.onError(
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
      );

      // Unlinked while Firecracker still has the memory file mapped, which keeps the mapping
      // alive and hands the disk back the moment the microVM exits. Leaving the files would put
      // the burden of removing them on every path that stops a VM instead.
      yield* discardSnapshot(appId);
      yield* Effect.logInfo('instance awake').pipe(Effect.annotateLogs({ appId, slot: slot.slot }));
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
  dependencies: [AgentConfig.Default, TenantLogReceiver.Default, ZerofsTopology.Default],
}) {}
