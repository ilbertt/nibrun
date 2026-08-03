import type { AppId, HostPort, Ipv4Address } from '@repo/protocol';

// Every per-app resource is derived from one small integer. A host port, a tap device, a /30
// and an NBD minor are four things that have to agree with each other for the lifetime of an
// app; deriving them from a single allocated slot means there is exactly one number to
// persist, and no way for three of the four to survive a restart while the fourth does not.
const SLOT_COUNT = 200;
const FIRST_SLOT = 0;

export const HOST_PORT_BASE = 21_000;

// A /30 per slot inside 10.201.0.0/16: .0 network, .1 host, .2 guest, .3 broadcast.
export const GUEST_NETWORK_CIDR = '10.201.0.0/16';
const GUEST_SUBNET_PREFIX_LENGTH = 30;
const ADDRESSES_PER_SLOT = 4;
const GUEST_NETWORK_FIRST_OCTET = 10;
const GUEST_NETWORK_SECOND_OCTET = 201;
const OCTET_SIZE = 256;
const HOST_ADDRESS_OFFSET = 1;
const GUEST_ADDRESS_OFFSET = 2;

export const TAP_NAME_PREFIX = 'nbr';

const HEX_RADIX = 16;
const MAC_OCTET_WIDTH = 2;
// Locally administered, unicast. The last four octets are the guest's address, so a MAC on the
// wire names the VM it belongs to without a lookup.
const MAC_PREFIX = '02:00';

export type AppSlot = {
  slot: number;
  appId: AppId;
  hostPort: HostPort;
  hostIpv4: Ipv4Address;
  guestIpv4: Ipv4Address;
  guestMac: string;
  tapName: string;
  nbdDevicePath: string;
  subnetPrefixLength: number;
};

export class SlotExhaustedError extends Error {
  constructor() {
    super(`No free slot: this host is limited to ${SLOT_COUNT} apps`);
    this.name = 'SlotExhaustedError';
  }
}

const addressAt = (index: number): Ipv4Address => {
  const third = Math.floor(index / OCTET_SIZE);
  const fourth = index % OCTET_SIZE;
  return `${GUEST_NETWORK_FIRST_OCTET}.${GUEST_NETWORK_SECOND_OCTET}.${third}.${fourth}` as Ipv4Address;
};

const macFor = (address: Ipv4Address) =>
  [
    MAC_PREFIX,
    ...address
      .split('.')
      .map((octet) => Number(octet).toString(HEX_RADIX).padStart(MAC_OCTET_WIDTH, '0')),
  ].join(':');

export function describeSlot({ slot, appId }: { slot: number; appId: AppId }): AppSlot {
  const base = slot * ADDRESSES_PER_SLOT;
  const hostIpv4 = addressAt(base + HOST_ADDRESS_OFFSET);
  const guestIpv4 = addressAt(base + GUEST_ADDRESS_OFFSET);
  return {
    slot,
    appId,
    hostPort: (HOST_PORT_BASE + slot) as HostPort,
    hostIpv4,
    guestIpv4,
    guestMac: macFor(guestIpv4),
    tapName: `${TAP_NAME_PREFIX}${slot}`,
    nbdDevicePath: `/dev/nbd${slot}`,
    subnetPrefixLength: GUEST_SUBNET_PREFIX_LENGTH,
  };
}

export type SlotRecords = Record<string, number>;

/**
 * Slots are allocated per app, never per instance, which is what makes a redeploy invisible to
 * the routing layer: same host, same port, new process behind it.
 *
 * They are released only on an explicit volume `absent`. That is the one signal in the
 * protocol that means an app is definitively gone; an instance merely missing from desired
 * state is a stop, and reusing its port for someone else would silently route a tenant's
 * traffic into another tenant's VM.
 */
export class SlotAllocator {
  readonly #byApp = new Map<AppId, number>();
  readonly #taken = new Set<number>();

  static fromRecords(records: SlotRecords): SlotAllocator {
    const allocator = new SlotAllocator();
    for (const [appId, slot] of Object.entries(records)) {
      if (!Number.isInteger(slot) || slot < FIRST_SLOT || slot >= SLOT_COUNT) {
        continue;
      }
      if (allocator.#taken.has(slot)) {
        continue;
      }
      allocator.#byApp.set(appId as AppId, slot);
      allocator.#taken.add(slot);
    }
    return allocator;
  }

  allocate(appId: AppId): AppSlot {
    const existing = this.#byApp.get(appId);
    if (existing !== undefined) {
      return describeSlot({ slot: existing, appId });
    }
    for (let slot = FIRST_SLOT; slot < SLOT_COUNT; slot += 1) {
      if (this.#taken.has(slot)) {
        continue;
      }
      this.#byApp.set(appId, slot);
      this.#taken.add(slot);
      return describeSlot({ slot, appId });
    }
    throw new SlotExhaustedError();
  }

  lookup(appId: AppId): AppSlot | undefined {
    const slot = this.#byApp.get(appId);
    return slot === undefined ? undefined : describeSlot({ slot, appId });
  }

  release(appId: AppId): void {
    const slot = this.#byApp.get(appId);
    if (slot === undefined) {
      return;
    }
    this.#byApp.delete(appId);
    this.#taken.delete(slot);
  }

  slots(): AppSlot[] {
    return [...this.#byApp.entries()].map(([appId, slot]) => describeSlot({ slot, appId }));
  }

  toRecords(): SlotRecords {
    return Object.fromEntries([...this.#byApp.entries()].map(([appId, slot]) => [appId, slot]));
  }
}

export function readSlotRecords(value: unknown): SlotRecords {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const records: SlotRecords = {};
  for (const [appId, slot] of Object.entries(value as Record<string, unknown>)) {
    if (typeof slot === 'number' && Number.isInteger(slot)) {
      records[appId] = slot;
    }
  }
  return records;
}
