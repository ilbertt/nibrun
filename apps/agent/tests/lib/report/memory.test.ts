import { describe, expect, test } from 'bun:test';
import { HOST_MEMORY_POLICY, readMemorySample } from '#lib/report/memory.ts';

const MIB = 1_048_576;
const CACHE_MIB = 2048;
const GUEST_CAPACITY_MIB = 9216;
const STORAGE_RESERVE_MIB = 6144;
const GROWN_STORAGE_MIB = 7000;
const GROWN_RESERVE_MIB = 7512;
const GROWN_GUEST_CAPACITY_MIB = 7848;
const LARGE_CACHE_MIB = 8192;
const LARGE_CACHE_RESERVE_MIB = 8704;
function sample(overrides: Partial<Parameters<typeof readMemorySample>[0]> = {}) {
  return readMemorySample({
    meminfo: 'MemTotal:       16777216 kB\nMemAvailable:   12582912 kB\n',
    zerofsCurrentBytes: String(CACHE_MIB * MIB),
    zerofsCacheBytes: CACHE_MIB * MIB,
    zerofsReserveMib: HOST_MEMORY_POLICY.zerofsReserveMib,
    ...overrides,
  });
}

describe('storage memory accounting', () => {
  test('reserves the total process budget even before its cache is full', () => {
    expect(sample().guestCapacityMib).toBe(GUEST_CAPACITY_MIB);
    expect(sample().zerofsReserveMib).toBe(STORAGE_RESERVE_MIB);
  });
  test('growth beyond the reserve reduces guest capacity with headroom', () => {
    const grown = sample({ zerofsCurrentBytes: String(GROWN_STORAGE_MIB * MIB) });
    expect(grown.zerofsReserveMib).toBe(GROWN_RESERVE_MIB);
    expect(grown.guestCapacityMib).toBe(GROWN_GUEST_CAPACITY_MIB);
  });
  test('a larger configured cache is reserved before it is resident', () => {
    expect(sample({ zerofsCacheBytes: LARGE_CACHE_MIB * MIB }).zerofsReserveMib).toBe(
      LARGE_CACHE_RESERVE_MIB,
    );
  });
  test('live memory pressure closes admission despite nominal budget', () => {
    const pressured = sample({ meminfo: 'MemTotal: 16777216 kB\nMemAvailable: 512000 kB\n' });
    expect(pressured.guestAvailableMib).toBe(0);
    expect(pressured.guestCapacityMib).toBeGreaterThan(0);
  });
  test('an oversubscribed host has no guest capacity', () => {
    expect(
      sample({ meminfo: 'MemTotal: 4194304 kB\nMemAvailable: 524288 kB\n' }).guestCapacityMib,
    ).toBe(0);
  });
  test.each(['', 'MemTotal: 1024 kB', 'MemTotal: 1024 kB\nMemAvailable: 2048 kB'])(
    'rejects incomplete or inconsistent readings: %s',
    (meminfo) => {
      expect(() => sample({ meminfo })).toThrow();
    },
  );
  test.each(['', '-1', 'garbage', '99999999999999999999999'])(
    'rejects invalid cgroup readings: %s',
    (zerofsCurrentBytes) => {
      expect(() => sample({ zerofsCurrentBytes })).toThrow();
    },
  );
});
