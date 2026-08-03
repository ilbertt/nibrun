import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesiredInstance, InstanceId } from '@repo/protocol';
import type { CommandRunner } from '#lib/exec.ts';
import { writeJsonFile } from '#lib/json-store.ts';
import type { AppSlot } from '#network/allocator.ts';
import { ensureTap } from '#network/tap.ts';
import { type ArtifactBytes, ensureArtifactImage } from '#vm/artifacts.ts';
import { renderFirecrackerConfig } from '#vm/firecracker-config.ts';
import { buildInstanceConfigImage } from '#vm/instance-env.ts';
import type { SystemdVmUnits } from '#vm/systemd.ts';

export const FIRECRACKER_CONFIG_FILENAME = 'firecracker.json';
export const GUEST_KERNEL_FILENAME = 'vmlinux';
export const GUEST_ROOTFS_FILENAME = 'rootfs.ext4';

const VM_DIR_MODE = 0o700;

export type VmManagerOptions = {
  runner: CommandRunner;
  units: SystemdVmUnits;
  artifacts: ArtifactBytes;
  artifactCacheDir: string;
  guestImageDir: string;
  vmDir: string;
};

export class VmManager {
  readonly #options: VmManagerOptions;

  constructor(options: VmManagerOptions) {
    this.#options = options;
  }

  workingDir(instanceId: InstanceId): string {
    return join(this.#options.vmDir, instanceId);
  }

  /**
   * Stages everything the VM needs and hands the boot to systemd.
   *
   * The agent never becomes the VM's parent: it writes the files, asks init to start the unit,
   * and stops caring. Everything staged here is either content-addressed and shared, or lives
   * under this instance's own directory, so two boots of the same app never race on a path.
   */
  async boot({
    desired,
    slot,
    dataDevicePath,
  }: {
    desired: DesiredInstance;
    slot: AppSlot;
    dataDevicePath: string;
  }): Promise<void> {
    const artifactImagePath = await ensureArtifactImage({
      source: this.#options.artifacts,
      runner: this.#options.runner,
      cacheDir: this.#options.artifactCacheDir,
      artifact: desired.artifact,
    });

    await ensureTap({
      runner: this.#options.runner,
      tap: {
        tapName: slot.tapName,
        hostIpv4: slot.hostIpv4,
        subnetPrefixLength: slot.subnetPrefixLength,
      },
    });

    const workingDir = this.workingDir(desired.instanceId);
    await mkdir(workingDir, { recursive: true, mode: VM_DIR_MODE });
    const instanceConfigImagePath = await buildInstanceConfigImage({
      runner: this.#options.runner,
      workingDir,
      guestPort: desired.config.guestPort,
      environment: desired.config.environment,
    });

    await writeJsonFile({
      path: join(workingDir, FIRECRACKER_CONFIG_FILENAME),
      value: renderFirecrackerConfig({
        resources: desired.config.resources,
        paths: {
          kernelPath: join(this.#options.guestImageDir, GUEST_KERNEL_FILENAME),
          rootfsPath: join(this.#options.guestImageDir, GUEST_ROOTFS_FILENAME),
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
      }),
    });

    await this.#options.units.start(desired.instanceId);
  }

  async stop({ instanceId }: { instanceId: InstanceId }): Promise<void> {
    await this.#options.units.stop(instanceId);
  }

  async discard({ instanceId }: { instanceId: InstanceId }): Promise<void> {
    await this.#options.units.forget(instanceId);
    await rm(this.workingDir(instanceId), { recursive: true, force: true });
  }
}
