import { isIP } from 'node:net';

/**
 * Every IPv4 address that is not the public internet: this network, the private ranges, loopback,
 * link-local — where the instance metadata service sits — carrier-grade NAT, the protocol and
 * benchmarking assignments, multicast, and the reserved space above them.
 */
const RESERVED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

/**
 * Allowed rather than refused, because IPv6 says outright which range is the internet: `2000::/3`
 * is global unicast, and everything outside it is loopback, link-local, unique-local, multicast,
 * or an IPv4 address embedded in a v6 one — which would have to be judged as an IPv4 address
 * anyway, and is refused here rather than unwrapped.
 */
const GLOBAL_UNICAST_FIRST = 0x2000;
const GLOBAL_UNICAST_LAST = 0x3fff;

const V4_BITS = 32;
const OCTET_VALUES = 256;
const HEX = 16;

export const IP_V4 = 4;
export const IP_V6 = 6;

/**
 * Whether an address is one the world can reach, rather than one only this network can.
 *
 * What it is for: a url is the caller's to name and the api's to dial, so without this the api is
 * a way to knock on doors inside the network that nobody outside it can reach — and to be told,
 * by which refusal comes back, which of them answered.
 */
export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case IP_V4:
      return !RESERVED_V4.some((range) => within({ address, range }));
    case IP_V6:
      return isGlobalUnicast(address);
    default:
      return false;
  }
}

/** The host as `isIP` reads it: a url brackets an IPv6 literal and an address is not bracketed. */
export function hostnameOf(url: URL): string {
  return url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
}

function within({ address, range }: { address: string; range: string }): boolean {
  const [base = '', bits = ''] = range.split('/');
  const addresses = 2 ** (V4_BITS - Number(bits));
  return Math.floor(asNumber(address) / addresses) === Math.floor(asNumber(base) / addresses);
}

function asNumber(address: string): number {
  let total = 0;
  for (const octet of address.split('.')) {
    total = total * OCTET_VALUES + Number(octet);
  }
  return total;
}

// A leading `::` is an address whose first hextet is zero, which no global unicast address has.
function isGlobalUnicast(address: string): boolean {
  const first = address.startsWith('::') ? 0 : Number.parseInt(address.split(':')[0] ?? '', HEX);
  return first >= GLOBAL_UNICAST_FIRST && first <= GLOBAL_UNICAST_LAST;
}
