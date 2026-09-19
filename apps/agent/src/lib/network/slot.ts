import {
  type AppId,
  type HostPort,
  HostPortSchema,
  type Ipv4Address,
  Ipv4AddressSchema,
  Value,
} from '@repo/protocol';

/**
 * A host port, a tap, a /30 and an NBD minor all derive from one small integer, so there is one
 * number to persist and no way for three of the four to survive a restart while the fourth does not.
 */
export const FIRST_SLOT = 0;

/**
 * How many `/dev/nbdN` this host will use, which is this agent's own ceiling on the apps it
 * holds and not the kernel's. `nbds_max` in `app_host_user_data.sh.tftpl` only says how many
 * minors exist when the module loads; a netlink connect names any index, and the kernel makes
 * the device on the spot — `nbd-client` has been netlink since `-connections` was asked of it,
 * and the same on a kernel with `nbds_max=4` attached `/dev/nbd100` and read it back.
 *
 * What does bound this is the instance store: every sleeping app keeps its memory there, and
 * `snapshotBudget` is what is left of `/data` beside ZeroFS's cache. At 128 the two meet for a
 * host asleep in every slot at the default memory size, so past here it is the cache that has
 * to give.
 */
const NBD_DEVICE_COUNT = 128;

const nbdDevicePath = (minor: number) => `/dev/nbd${minor}`;

/**
 * Held back from the app range, because an export reads a checkpoint served by a second ZeroFS
 * and that needs a device the live volume is not already on. Reserved rather than taken from the
 * free ones on the day: an app's slot persists and an export's does not, so a minor a later
 * reconcile could hand to an app is not one an export may borrow now.
 *
 * One device, so one export reads at a time on a host — `ExportManager` is where that is enforced
 * rather than assumed.
 */
export const EXPORT_READER_DEVICE_PATH = nbdDevicePath(NBD_DEVICE_COUNT - 1);

/** Everything below the reader's device: ports and taps are cheap, and the minors are the ceiling. */
export const SLOT_COUNT = NBD_DEVICE_COUNT - 1;

export const HOST_PORT_BASE = 21_000;

/**
 * Where the port an app asking for one is reached at starts. A slot's own, so nothing has to be
 * allocated or told apart, and the same number on both sides of every hop — a binary that
 * announces the port it bound has to be announcing one that reaches it.
 *
 * `tenant_port_first` in infra/terraform bounds the range the relay forwards and the security
 * group admits, and `SLOT_COUNT` is what decides how far it has to reach.
 */
export const EXTRA_PUBLIC_PORT_BASE = 22_000;

/** A /30 per slot: .0 network, .1 host, .2 guest, .3 broadcast. */
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
/** Locally administered and unicast, with the guest address in the last four octets. */
const MAC_PREFIX = '02:00';

export type AppSlot = {
  readonly slot: number;
  readonly appId: AppId;
  readonly hostPort: HostPort;
  readonly extraPublicPort: HostPort;
  readonly hostIpv4: Ipv4Address;
  readonly guestIpv4: Ipv4Address;
  readonly guestMac: string;
  readonly tapName: string;
  readonly nbdDevicePath: string;
  readonly subnetPrefixLength: number;
};

const addressAt = (index: number): Ipv4Address =>
  Value.Parse(
    Ipv4AddressSchema,
    `${GUEST_NETWORK_FIRST_OCTET}.${GUEST_NETWORK_SECOND_OCTET}.${Math.floor(index / OCTET_SIZE)}.${index % OCTET_SIZE}`,
  );

const macFor = (address: Ipv4Address) =>
  [
    MAC_PREFIX,
    ...address
      .split('.')
      .map((octet) => Number(octet).toString(HEX_RADIX).padStart(MAC_OCTET_WIDTH, '0')),
  ].join(':');

export function describeSlot({ slot, appId }: { slot: number; appId: AppId }): AppSlot {
  const base = slot * ADDRESSES_PER_SLOT;
  const guestIpv4 = addressAt(base + GUEST_ADDRESS_OFFSET);
  return {
    slot,
    appId,
    hostPort: Value.Parse(HostPortSchema, HOST_PORT_BASE + slot),
    extraPublicPort: Value.Parse(HostPortSchema, EXTRA_PUBLIC_PORT_BASE + slot),
    hostIpv4: addressAt(base + HOST_ADDRESS_OFFSET),
    guestIpv4,
    guestMac: macFor(guestIpv4),
    tapName: `${TAP_NAME_PREFIX}${slot}`,
    nbdDevicePath: nbdDevicePath(slot),
    subnetPrefixLength: GUEST_SUBNET_PREFIX_LENGTH,
  };
}
