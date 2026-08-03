import { describe, expect, test } from 'bun:test';
import type { AppId, HostPort, Ipv4Address } from '@repo/protocol';
import {
  describeSlot,
  HOST_PORT_BASE,
  readSlotRecords,
  SlotAllocator,
  SlotExhaustedError,
} from '#network/allocator.ts';

const app = (name: string | number) => `app-${name}` as AppId;

const SLOT_COUNT = 200;
const SUBNET_PREFIX_LENGTH = 30;
const BOUNDARY_SLOT = 64;
const SOME_SLOT = 3;
const DISTINCT_APPS = ['alpha', 'beta', 'gamma'];
const BEYOND_THE_LAST_SLOT = 1_000;

describe('slot derivation', () => {
  test('every per-app resource comes from the one number', () => {
    expect(describeSlot({ slot: 0, appId: app(0) })).toEqual({
      slot: 0,
      appId: app(0),
      hostPort: HOST_PORT_BASE,
      hostIpv4: '10.201.0.1',
      guestIpv4: '10.201.0.2',
      guestMac: '02:00:0a:c9:00:02',
      tapName: 'nbr0',
      nbdDevicePath: '/dev/nbd0',
      subnetPrefixLength: SUBNET_PREFIX_LENGTH,
    } as ReturnType<typeof describeSlot>);
  });

  test('slots do not overlap', () => {
    const first = describeSlot({ slot: 0, appId: app(0) });
    const second = describeSlot({ slot: 1, appId: app(1) });
    expect(second.hostIpv4).toBe('10.201.0.5' as Ipv4Address);
    expect(second.guestIpv4).toBe('10.201.0.6' as Ipv4Address);
    expect(second.hostPort).toBe((first.hostPort + 1) as HostPort);
  });

  test('addressing carries past an octet boundary', () => {
    expect(describeSlot({ slot: BOUNDARY_SLOT, appId: app(BOUNDARY_SLOT) }).guestIpv4).toBe(
      '10.201.1.2' as Ipv4Address,
    );
  });
});

describe('allocation is stable for the lifetime of an app', () => {
  test('a second allocation for the same app returns the same slot', () => {
    const allocator = new SlotAllocator();
    const first = allocator.allocate(app(1));
    const second = allocator.allocate(app(1));
    expect(second).toEqual(first);
  });

  test('a redeploy keeps the host port, which is what makes it invisible to routing', () => {
    const allocator = new SlotAllocator();
    const before = allocator.allocate(app(1)).hostPort;
    // A redeploy is a new instance of the same app; nothing about the app's slot changes.
    expect(allocator.allocate(app(1)).hostPort).toBe(before);
  });

  test('distinct apps never share a slot', () => {
    const allocator = new SlotAllocator();
    const ports = new Set(DISTINCT_APPS.map((name) => allocator.allocate(app(name)).hostPort));
    expect(ports.size).toBe(DISTINCT_APPS.length);
  });
});

describe('allocation survives an agent restart', () => {
  test('records round-trip through the persisted shape', () => {
    const allocator = new SlotAllocator();
    allocator.allocate(app(1));
    allocator.allocate(app(2));
    const revived = SlotAllocator.fromRecords(
      readSlotRecords(JSON.parse(JSON.stringify(allocator.toRecords()))),
    );
    expect(revived.lookup(app(2))).toEqual(allocator.lookup(app(2)));
  });

  test('a revived allocator does not hand a live slot to a new app', () => {
    const allocator = new SlotAllocator();
    allocator.allocate(app(1));
    const revived = SlotAllocator.fromRecords(allocator.toRecords());
    expect(revived.allocate(app(BEYOND_THE_LAST_SLOT)).slot).not.toBe(revived.lookup(app(1))?.slot);
  });

  test('a corrupted record file degrades to an empty allocator rather than throwing', () => {
    expect(readSlotRecords('nonsense')).toEqual({});
    expect(readSlotRecords({ 'app-1': 'three', 'app-2': SOME_SLOT })).toEqual({
      'app-2': SOME_SLOT,
    });
  });

  test('duplicate slots in a persisted file are not both honoured', () => {
    const revived = SlotAllocator.fromRecords({ 'app-1': SOME_SLOT, 'app-2': SOME_SLOT });
    expect(revived.lookup(app(1))?.slot).toBe(SOME_SLOT);
    expect(revived.lookup(app(2))).toBeUndefined();
  });
});

describe('release', () => {
  test('a released slot becomes available again', () => {
    const allocator = new SlotAllocator();
    const slot = allocator.allocate(app(1)).slot;
    allocator.release(app(1));
    expect(allocator.lookup(app(1))).toBeUndefined();
    expect(allocator.allocate(app(2)).slot).toBe(slot);
  });
});

describe('exhaustion', () => {
  test('running out of slots is an error, not a silent reuse', () => {
    const allocator = new SlotAllocator();
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      allocator.allocate(app(index));
    }
    expect(() => allocator.allocate(app(BEYOND_THE_LAST_SLOT))).toThrow(SlotExhaustedError);
  });
});
