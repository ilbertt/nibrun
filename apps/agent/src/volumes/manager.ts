import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppId, DesiredVolume, ReportedVolume, VolumeId } from '@repo/protocol';
import type { CommandRunner } from '#lib/exec.ts';
import { describeError, logger } from '#lib/logger.ts';
import type { SlotAllocator } from '#network/allocator.ts';
import type { ObservedVolume } from '#reconcile/plan.ts';
import { devicePathFor, ensureDeviceFile, NBD_DIRECTORY } from '#volumes/device-file.ts';
import { formatOnce } from '#volumes/ext4.ts';
import { attach, detach, isAttached } from '#volumes/nbd.ts';
import type { ZerofsFilesystem, ZerofsTopology } from '#volumes/topology.ts';

const EMPTY_SIZE = 0;

export type VolumeManagerOptions = {
  runner: CommandRunner;
  topology: ZerofsTopology;
  allocator: SlotAllocator;
};

/**
 * What the host can say about a volume purely from having found it.
 *
 * The report is derived from the observation rather than accumulated from provisioning, so a
 * volume that is simply healthy still reports itself. Building it the other way round meant a
 * volume was described in the one reconcile that created it and never again — and since these
 * reports do not survive a restart, an agent that came back reported no volumes at all while
 * serving one.
 */
export function toReportedVolume(observed: ObservedVolume): ReportedVolume {
  return {
    volumeId: observed.volumeId,
    state: observed.attached ? 'ready' : 'detached',
    sizeBytes: observed.sizeBytes,
    storagePrefix: observed.storagePrefix,
    ...(observed.devicePath ? { devicePath: observed.devicePath } : {}),
  };
}

export class VolumeManager {
  readonly #options: VolumeManagerOptions;

  constructor(options: VolumeManagerOptions) {
    this.#options = options;
  }

  /**
   * Enumerates the device files ZeroFS is exporting, which is the truth a restarted agent
   * converges against — not what it remembers having created.
   */
  async observe({
    appIdByVolume,
  }: {
    appIdByVolume: ReadonlyMap<VolumeId, AppId>;
  }): Promise<ObservedVolume[]> {
    const observed: ObservedVolume[] = [];
    for (const filesystem of this.#options.topology.all()) {
      observed.push(...(await this.#observeFilesystem({ filesystem, appIdByVolume })));
    }
    return observed;
  }

  async provision({ desired }: { desired: DesiredVolume }): Promise<ReportedVolume> {
    const filesystem = this.#options.topology.place();
    const slot = this.#options.allocator.allocate(desired.appId);
    const path = devicePathFor({ mount: filesystem.mountPath, volumeId: desired.volumeId });
    const sizeBytes = await ensureDeviceFile({ path, sizeBytes: desired.sizeBytes });

    if (!(await isAttached({ runner: this.#options.runner, devicePath: slot.nbdDevicePath }))) {
      await attach({
        runner: this.#options.runner,
        socketPath: filesystem.nbdSocketPath,
        devicePath: slot.nbdDevicePath,
        volumeId: desired.volumeId,
      });
    }

    const formatted = await formatOnce({
      runner: this.#options.runner,
      devicePath: slot.nbdDevicePath,
    });
    if (formatted) {
      logger.info({
        message: 'volume formatted',
        volumeId: desired.volumeId,
        device: slot.nbdDevicePath,
      });
    }

    return {
      volumeId: desired.volumeId,
      state: 'ready',
      sizeBytes,
      devicePath: slot.nbdDevicePath,
      storagePrefix: filesystem.storagePrefix,
    };
  }

  /**
   * The only path that destroys tenant data, and it runs only for a volume the control plane
   * has explicitly marked `absent`. A flush first, so the detach happens at a durability point
   * rather than dropping whatever the periodic flush had not yet uploaded — with `ignore_fsync`
   * the guest's own barriers were never a durability point at all.
   */
  async teardown({ desired }: { desired: DesiredVolume }): Promise<ReportedVolume> {
    const filesystem = this.#options.topology.place();
    const slot = this.#options.allocator.lookup(desired.appId);
    await filesystem.admin.flush();
    if (slot) {
      await detach({ runner: this.#options.runner, devicePath: slot.nbdDevicePath });
    }
    await rm(devicePathFor({ mount: filesystem.mountPath, volumeId: desired.volumeId }), {
      force: true,
    });
    this.#options.allocator.release(desired.appId);
    return { volumeId: desired.volumeId, state: 'deleting', sizeBytes: EMPTY_SIZE };
  }

  async #observeFilesystem({
    filesystem,
    appIdByVolume,
  }: {
    filesystem: ZerofsFilesystem;
    appIdByVolume: ReadonlyMap<VolumeId, AppId>;
  }): Promise<ObservedVolume[]> {
    const directory = join(filesystem.mountPath, NBD_DIRECTORY);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      logger.warn({
        message: 'zerofs nbd directory unreadable',
        directory,
        ...describeError(error),
      });
      return [];
    }

    const observed: ObservedVolume[] = [];
    for (const name of names) {
      const volumeId = name as VolumeId;
      const sizeBytes = await this.#sizeOf(join(directory, name));
      if (sizeBytes === undefined) {
        continue;
      }
      const slot = this.#slotFor({ volumeId, appIdByVolume });
      observed.push({
        volumeId,
        sizeBytes,
        storagePrefix: filesystem.storagePrefix,
        attached: slot
          ? await isAttached({ runner: this.#options.runner, devicePath: slot.nbdDevicePath })
          : false,
        ...(slot ? { devicePath: slot.nbdDevicePath } : {}),
      });
    }
    return observed;
  }

  async #sizeOf(path: string): Promise<number | undefined> {
    try {
      const entry = await stat(path);
      return entry.isFile() ? entry.size : undefined;
    } catch {
      return undefined;
    }
  }

  #slotFor({
    volumeId,
    appIdByVolume,
  }: {
    volumeId: VolumeId;
    appIdByVolume: ReadonlyMap<VolumeId, AppId>;
  }) {
    const appId = appIdByVolume.get(volumeId);
    return appId === undefined ? undefined : this.#options.allocator.lookup(appId);
  }
}
