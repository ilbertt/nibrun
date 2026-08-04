import { FileSystem, Path } from '@effect/platform';
import type { DesiredInstance, InstanceId } from '@repo/protocol';
import { Effect } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import { TENANT_LOG_VSOCK_FILENAME, tenantLogSocketPath } from '#logs/vsock.ts';
import type { AppSlot } from '#network/slot.ts';
import { ensureTap } from '#network/tap.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';
import * as Artifacts from '#vm/artifacts.ts';
import { renderFirecrackerConfig } from '#vm/firecracker-config.ts';
import { buildInstanceConfigImage } from '#vm/instance-env.ts';
import * as Systemd from '#vm/systemd.ts';

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

    const workingDir = (instanceId: InstanceId) => path.join(config.vmDir, instanceId);

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
        instanceId: desired.instanceId,
        appId: desired.appId,
      });
      const artifactImagePath = yield* Artifacts.ensureArtifactImage(desired.artifact);
      yield* ensureTap({
        tapName: slot.tapName,
        hostIpv4: slot.hostIpv4,
        subnetPrefixLength: slot.subnetPrefixLength,
      });

      const directory = workingDir(desired.instanceId);
      yield* fs.makeDirectory(directory, { recursive: true, mode: VM_DIR_MODE });
      const instanceConfigImagePath = yield* buildInstanceConfigImage({
        workingDir: directory,
        guestPort: desired.config.guestPort,
        args: desired.config.args,
        environment: desired.config.environment,
        restartPolicy: desired.config.restartPolicy,
        dnsServers: config.guestDnsServers,
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
            path: TENANT_LOG_VSOCK_FILENAME,
          },
        }),
      });

      yield* logs.attach({
        source: {
          instanceId: desired.instanceId,
          appId: desired.appId,
          deploymentId: desired.deploymentId,
        },
        socketPath: tenantLogSocketPath({ workingDir: directory }),
      });
      yield* Effect.onError(Systemd.start(desired.instanceId), () =>
        Effect.ignore(logs.detach(desired.instanceId)),
      );
    });

    return {
      workingDir,
      boot,
      stop: Systemd.stop,
      discard: Effect.fn('VmManager.discard')(function* (instanceId: InstanceId) {
        yield* Effect.annotateCurrentSpan({ instanceId });
        yield* Systemd.forget(instanceId);
        yield* logs.detach(instanceId);
        yield* fs.remove(workingDir(instanceId), { recursive: true, force: true });
      }),
    };
  }),
  dependencies: [AgentConfig.Default, TenantLogReceiver.Default],
}) {}
