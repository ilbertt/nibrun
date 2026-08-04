import type { AppId, HostPort, Ipv4Address } from '@repo/protocol';

/**
 * A host port, a tap, a /30 and an NBD minor all derive from one small integer, so there is one
 * number to persist and no way for three of the four to survive a restart while the fourth does not.
 */
export const SLOT_COUNT = 200;
export const FIRST_SLOT = 0;

export const HOST_PORT_BASE = 21_000;

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
  readonly hostIpv4: Ipv4Address;
  readonly guestIpv4: Ipv4Address;
  readonly guestMac: string;
  readonly tapName: string;
  readonly nbdDevicePath: string;
  readonly subnetPrefixLength: number;
};

const addressAt = (index: number): Ipv4Address =>
  `${GUEST_NETWORK_FIRST_OCTET}.${GUEST_NETWORK_SECOND_OCTET}.${Math.floor(index / OCTET_SIZE)}.${index % OCTET_SIZE}` as Ipv4Address;

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
    hostPort: (HOST_PORT_BASE + slot) as HostPort,
    hostIpv4: addressAt(base + HOST_ADDRESS_OFFSET),
    guestIpv4,
    guestMac: macFor(guestIpv4),
    tapName: `${TAP_NAME_PREFIX}${slot}`,
    nbdDevicePath: `/dev/nbd${slot}`,
    subnetPrefixLength: GUEST_SUBNET_PREFIX_LENGTH,
  };
}
