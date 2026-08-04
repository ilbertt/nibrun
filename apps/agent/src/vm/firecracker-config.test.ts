import { describe, expect, test } from 'bun:test';
import { DEFAULT_INSTANCE_RESOURCES, type Ipv4Address } from '@repo/protocol';
import {
  DRIVE_IDS,
  netmaskFor,
  renderFirecrackerConfig,
  renderKernelArgs,
} from '#vm/firecracker-config.ts';

const SUBNET_PREFIX_LENGTH = 30;
const SLASH_24 = 24;
const SLASH_16 = 16;
const SLASH_32 = 32;
const SLASH_0 = 0;

const network = {
  tapName: 'nbr3',
  guestMac: '02:00:0a:c9:00:0e',
  guestIpv4: '10.201.0.14' as Ipv4Address,
  hostIpv4: '10.201.0.13' as Ipv4Address,
  subnetPrefixLength: SUBNET_PREFIX_LENGTH,
};

const paths = {
  kernelPath: '/opt/nibrun/bin/guest-image/vmlinux',
  rootfsPath: '/opt/nibrun/bin/guest-image/rootfs.ext4',
  artifactImagePath: '/var/lib/nibrun/artifacts/abc/artifact.squashfs',
  instanceConfigImagePath: '/var/lib/nibrun/vm/inst-1/config.squashfs',
  dataDevicePath: '/dev/nbd3',
};

const config = () =>
  renderFirecrackerConfig({ resources: DEFAULT_INSTANCE_RESOURCES, paths, network });

describe('the drive order is the boot contract', () => {
  test('vda vdb vdc vdd are rootfs, artifact, instance config, tenant data', () => {
    expect(config().drives.map((drive) => drive.drive_id)).toEqual([...DRIVE_IDS]);
    expect(config().drives.map((drive) => drive.path_on_host)).toEqual([
      paths.rootfsPath,
      paths.artifactImagePath,
      paths.instanceConfigImagePath,
      paths.dataDevicePath,
    ]);
  });

  test('only the rootfs is the root device', () => {
    expect(config().drives.filter((drive) => drive.is_root_device)).toHaveLength(1);
    expect(config().drives[0]?.is_root_device).toBe(true);
  });
});

describe('the setting that fails silently', () => {
  test('the tenant data drive is Writeback, so a guest fsync reaches the host', () => {
    const data = config().drives.at(-1);
    expect(data?.cache_type).toBe('Writeback');
    expect(data?.is_read_only).toBe(false);
  });

  test('the three read-only drives have nothing to flush', () => {
    for (const drive of config().drives.slice(0, -1)) {
      expect(drive.is_read_only).toBe(true);
      expect(drive.cache_type).toBe('Unsafe');
    }
  });

  test('every drive uses the sync io engine', () => {
    for (const drive of config().drives) {
      expect(drive.io_engine).toBe('Sync');
    }
  });
});

describe('the kernel command line', () => {
  test('the tenant console is not flooded by informational kernel messages', () => {
    expect(renderKernelArgs(network)).toContain('console=ttyS0 quiet');
  });

  test('it carries the three i8042 flags that halve boot time', () => {
    const args = renderKernelArgs(network);
    for (const flag of ['i8042.noaux', 'i8042.nomux', 'i8042.dumbkbd']) {
      expect(args).toContain(flag);
    }
  });

  // The fourth flag breaks SendCtrlAltDel on an ACPI-enabled guest, and the failure is silent:
  // the API answers 204 and the VMM reports success whether or not the guest can hear it, so a
  // graceful stop degrades to killing the VMM with the tenant mid-write.
  test('it does not carry i8042.nopnp, which would break a graceful stop', () => {
    expect(renderKernelArgs(network)).not.toContain('i8042.nopnp');
  });

  test('the static ip form means the guest needs no DHCP client', () => {
    expect(renderKernelArgs(network)).toContain(
      'ip=10.201.0.14::10.201.0.13:255.255.255.252::eth0:off',
    );
  });

  test('the root is the first drive, read-only, with the runtime as pid 1', () => {
    const args = renderKernelArgs(network);
    expect(args).toContain('root=/dev/vda ro init=/init');
    expect(args).toContain('console=ttyS0');
    expect(args).toContain('panic=1');
  });
});

describe('netmaskFor', () => {
  test('common prefixes render as dotted quads', () => {
    expect(netmaskFor(SUBNET_PREFIX_LENGTH)).toBe('255.255.255.252');
    expect(netmaskFor(SLASH_24)).toBe('255.255.255.0');
    expect(netmaskFor(SLASH_16)).toBe('255.255.0.0');
    expect(netmaskFor(SLASH_32)).toBe('255.255.255.255');
    expect(netmaskFor(SLASH_0)).toBe('0.0.0.0');
  });
});

describe('machine and network', () => {
  test('resources come from the app config and the tap from the allocated slot', () => {
    expect(config()['machine-config']).toEqual({
      vcpu_count: DEFAULT_INSTANCE_RESOURCES.vcpuCount,
      mem_size_mib: DEFAULT_INSTANCE_RESOURCES.memoryMib,
      smt: false,
    });
    expect(config()['network-interfaces']).toEqual([
      { iface_id: 'eth0', host_dev_name: 'nbr3', guest_mac: network.guestMac },
    ]);
  });
});
