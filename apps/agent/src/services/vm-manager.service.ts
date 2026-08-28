import { FileSystem, Path } from '@effect/platform';
import type { AppId, DesiredInstance } from '@repo/protocol';
import { Effect } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import { tenantLogSocketPath } from '#lib/logs/vsock.ts';
import type { AppSlot } from '#lib/network/slot.ts';
import { ensureTap } from '#lib/network/tap.ts';
import * as Artifacts from '#lib/vm/artifacts.ts';
import { renderFirecrackerConfig } from '#lib/vm/firecracker-config.ts';
import { buildInstanceConfigImage } from '#lib/vm/instance-env.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { GUEST_VSOCK_FILENAME, vmWorkingDir } from '#lib/vm/vsock.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';

export const FIRECRACKER_CONFIG_FILENAME = 'firecracker.json';
export const GUEST_KERNEL_FILENAME = 'vmlinux';
export const GUEST_ROOTFS_FILENAME = 'rootfs.ext4';

const VM_DIR_MODE = 0o700;
const FIRST_GUEST_CID = 3;

export class VmManager extends Effect.Service<VmManager>()('VmManager', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const logs = yield* TenantLogReceiver;

    const workingDir = (appId: AppId) => vmWorkingDir({ vmDir: config.vmDir, appId });

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

    return {
      workingDir,
      boot,
      stop: Systemd.stop,
      discard: Effect.fn('VmManager.discard')(function* (appId: AppId) {
        yield* Effect.annotateCurrentSpan({ appId });
        yield* Systemd.forget(appId);
        yield* logs.detach(appId);
        yield* fs.remove(workingDir(appId), { recursive: true, force: true });
      }),
    };
  }),
  dependencies: [AgentConfig.Default, TenantLogReceiver.Default],
}) {}
