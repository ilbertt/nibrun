import { describe, expect, test } from 'bun:test';
import { hostnameOf, isPublicAddress } from '#lib/public-address.ts';

/**
 * The api dials what a caller names, from inside a network the caller is not in. Everything below
 * is about one question: is this an address they could have fetched from themselves, or one the
 * api would only be reaching on their behalf?
 */
describe('an address is either one the world can reach or one only this network can', () => {
  test.each([
    ['8.8.8.8', 'a public v4 address'],
    ['1.1.1.1', 'another'],
    ['104.20.23.154', 'one a release host actually answers on'],
    ['172.15.255.255', 'the address below the private range'],
    ['172.32.0.0', 'the address above it'],
    ['100.63.255.255', 'the address below carrier-grade NAT'],
  ])('%s is dialled — %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  test.each([
    ['0.0.0.0', 'this network'],
    ['10.1.2.3', 'a private range'],
    ['172.16.0.1', 'the low end of another'],
    ['172.31.255.254', 'the high end of the same one'],
    ['192.168.1.1', 'the third'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'the rest of loopback'],
    ['169.254.169.254', 'the instance metadata service'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['192.0.0.1', 'the protocol assignments'],
    ['198.18.0.1', 'the benchmarking range'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('%s is refused — %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

/**
 * Allowed rather than refused, because IPv6 names its own internet: `2000::/3` is global unicast
 * and everything else is loopback, link-local, unique-local, multicast, or a v4 address wearing a
 * v6 address's clothes.
 */
describe('IPv6 is judged by the one range that is the internet', () => {
  test.each([
    ['2001:db8::1', 'documentation, inside global unicast'],
    ['2606:4700::6810:85e5', 'a release host'],
    ['3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'the top of the range'],
  ])('%s is dialled — %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  test.each([
    ['::1', 'loopback'],
    ['::', 'the unspecified address'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456::1', 'the rest of unique-local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'loopback wearing a v6 address'],
    ['::ffff:10.0.0.1', 'a private v4 address wearing one'],
    ['64:ff9b::8.8.8.8', 'NAT64, which embeds a v4 address this cannot judge as one'],
    ['1fff::1', 'just below global unicast'],
    ['4000::1', 'just above it'],
  ])('%s is refused — %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe('what is not an address at all is not one this dials', () => {
  test.each([['releases.test'], ['localhost'], [''], ['999.1.1.1'], ['10.0.0']])(
    '%s is refused',
    (host) => {
      expect(isPublicAddress(host)).toBe(false);
    },
  );
});

// A url brackets an IPv6 literal and an address does not, so the two disagree about the same host
// unless one of them gives way.
describe('the host of a url is read the way an address is written', () => {
  test('a name is itself', () => {
    expect(hostnameOf(new URL('https://releases.test/my-server'))).toBe('releases.test');
  });

  test('a v4 literal is itself', () => {
    expect(hostnameOf(new URL('https://10.0.0.5/my-server'))).toBe('10.0.0.5');
  });

  test('a v6 literal comes out of its brackets', () => {
    expect(hostnameOf(new URL('https://[2001:db8::1]/my-server'))).toBe('2001:db8::1');
  });
});
