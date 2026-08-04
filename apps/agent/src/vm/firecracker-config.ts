import type { InstanceResources, Ipv4Address } from '@repo/protocol';

// Firecracker assigns virtio-blk devices in the order this array declares them, so the order
// is the boot contract: vda rootfs, vdb artifact, vdc instance config, vdd tenant data.
export const DRIVE_IDS = ['rootfs', 'artifact', 'config', 'data'] as const;

const OCTET_BITS = 8;
const FULL_OCTET = 255;
const OCTET_COUNT = 4;
const NO_BITS = 0;

// Three i8042 flags, and a measured 1.02 s to 0.60 s boot win. `i8042.nopnp` is deliberately
// not among them: it breaks SendCtrlAltDel on an ACPI-enabled guest, which ours is, so a
// graceful stop would silently become a kill — the API answers 204 either way. The static `ip=`
// form is why the guest ships no DHCP client: the kernel configures eth0 before /init runs.
//
// `quiet` keeps the guest's operator console useful: without it a boot puts ~788 printk lines
// ahead of the runtime diagnostics. It raises the printk threshold and nothing else — panics,
// oopses and the guest init's own `[nibrun] ` writes are untouched. Tenant output does not share
// this console; it travels over the dedicated vsock below.
const BASE_KERNEL_ARGS =
  'console=ttyS0 quiet reboot=k panic=1 pci=off i8042.noaux i8042.nomux i8042.dumbkbd root=/dev/vda ro init=/init';

export function netmaskFor(prefixLength: number): string {
  const octets: number[] = [];
  for (let index = 0; index < OCTET_COUNT; index += 1) {
    const bits = Math.min(Math.max(prefixLength - index * OCTET_BITS, NO_BITS), OCTET_BITS);
    octets.push(FULL_OCTET & ~((1 << (OCTET_BITS - bits)) - 1));
  }
  return octets.join('.');
}

export function renderKernelArgs({
  guestIpv4,
  hostIpv4,
  subnetPrefixLength,
}: {
  guestIpv4: Ipv4Address;
  hostIpv4: Ipv4Address;
  subnetPrefixLength: number;
}): string {
  const netmask = netmaskFor(subnetPrefixLength);
  return `${BASE_KERNEL_ARGS} ip=${guestIpv4}::${hostIpv4}:${netmask}::eth0:off`;
}

export type FirecrackerDrive = {
  drive_id: string;
  path_on_host: string;
  is_root_device: boolean;
  is_read_only: boolean;
  cache_type: 'Unsafe' | 'Writeback';
  io_engine: 'Sync' | 'Async';
};

export type FirecrackerConfig = {
  'boot-source': { kernel_image_path: string; boot_args: string };
  drives: FirecrackerDrive[];
  'machine-config': { vcpu_count: number; mem_size_mib: number; smt: boolean };
  'network-interfaces': { iface_id: string; host_dev_name: string; guest_mac: string }[];
  vsock: { guest_cid: number; uds_path: string };
};

const READ_ONLY_DRIVE = {
  is_root_device: false,
  is_read_only: true,
  // Meaningless on a read-only drive: there is nothing to flush.
  cache_type: 'Unsafe',
  // io_uring is still a developer preview upstream, adds device-creation latency to every cold
  // start, and its workers escape the cgroup the VM is confined to.
  io_engine: 'Sync',
} as const satisfies Omit<FirecrackerDrive, 'drive_id' | 'path_on_host'>;

export type VmPaths = {
  kernelPath: string;
  rootfsPath: string;
  artifactImagePath: string;
  instanceConfigImagePath: string;
  dataDevicePath: string;
};

export type VmNetwork = {
  tapName: string;
  guestMac: string;
  guestIpv4: Ipv4Address;
  hostIpv4: Ipv4Address;
  subnetPrefixLength: number;
};

export type VmVsock = {
  guestCid: number;
  path: string;
};

const NETWORK_INTERFACE_ID = 'eth0';

/**
 * The whole VM, as one file Firecracker both configures and boots from.
 *
 * `cache_type` on the data drive is the one setting here that fails silently. Firecracker
 * defaults a drive to `Unsafe`, which discards flush requests: the guest's fsync returns
 * success, ZeroFS is never asked to flush, and the loss window stops being the flush interval
 * and becomes unbounded. Nothing observable goes wrong until a host dies.
 */
export function renderFirecrackerConfig({
  resources,
  paths,
  network,
  vsock,
}: {
  resources: InstanceResources;
  paths: VmPaths;
  network: VmNetwork;
  vsock: VmVsock;
}): FirecrackerConfig {
  return {
    'boot-source': {
      kernel_image_path: paths.kernelPath,
      boot_args: renderKernelArgs(network),
    },
    drives: [
      {
        ...READ_ONLY_DRIVE,
        drive_id: DRIVE_IDS[0],
        path_on_host: paths.rootfsPath,
        is_root_device: true,
      },
      { ...READ_ONLY_DRIVE, drive_id: DRIVE_IDS[1], path_on_host: paths.artifactImagePath },
      { ...READ_ONLY_DRIVE, drive_id: DRIVE_IDS[2], path_on_host: paths.instanceConfigImagePath },
      {
        drive_id: DRIVE_IDS[3],
        path_on_host: paths.dataDevicePath,
        is_root_device: false,
        is_read_only: false,
        cache_type: 'Writeback',
        io_engine: 'Sync',
      },
    ],
    'machine-config': {
      vcpu_count: resources.vcpuCount,
      mem_size_mib: resources.memoryMib,
      smt: false,
    },
    'network-interfaces': [
      {
        iface_id: NETWORK_INTERFACE_ID,
        host_dev_name: network.tapName,
        guest_mac: network.guestMac,
      },
    ],
    vsock: {
      guest_cid: vsock.guestCid,
      uds_path: vsock.path,
    },
  };
}
