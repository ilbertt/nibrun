import { describe, expect, test } from 'bun:test';
import { AppIdSchema, DEFAULT_INSTANCE_RESOURCES, type InstanceState, Value } from '@repo/protocol';
import { committedResources, guestMemoryMib, memoryShortfallMib } from '#lib/report/capacity.ts';
import { instanceRecord } from '#tests/support/fixtures.ts';

const APP_MEMORY_MIB = DEFAULT_INSTANCE_RESOURCES.memoryMib;
const NEIGHBOURS_THAT_FIT = 3;
const HOST_MEMORY_MIB = APP_MEMORY_MIB * (NEIGHBOURS_THAT_FIT + 1);

function neighbours({ count, state }: { count: number; state: InstanceState }) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    records.push(instanceRecord({ appId: Value.Parse(AppIdSchema, `neighbour-${index}`), state }));
  }
  return records;
}

/** What one more of the default-sized apps would cost this host beyond what it has. */
function shortfall({ count, state }: { count: number; state: InstanceState }) {
  return memoryShortfallMib({
    hostMemoryMib: HOST_MEMORY_MIB,
    committed: committedResources(neighbours({ count, state })),
    wanted: DEFAULT_INSTANCE_RESOURCES,
  });
}

/**
 * The refusal a wake is made on. Memory is counted against what the host has rather than against
 * what the control plane placed here, because a sleeping app gave its share back and the whole
 * point of `on-request` is that somebody else may have taken it.
 */
describe('a host has room for one more microVM until it does not', () => {
  test('an empty host has room', () => {
    expect(shortfall({ count: 0, state: 'running' })).toBe(0);
  });

  test('so has one filled to exactly the last app it fits', () => {
    expect(shortfall({ count: NEIGHBOURS_THAT_FIT, state: 'running' })).toBe(0);
  });

  test('one app past that is short by exactly what the app asked for', () => {
    expect(shortfall({ count: NEIGHBOURS_THAT_FIT + 1, state: 'running' })).toBe(APP_MEMORY_MIB);
  });

  // The saving and the failure mode are the same fact: a host packed with sleeping apps has all
  // its memory free, and every one of them can be woken until the memory runs out.
  test('a neighbour asleep between requests is holding none of it', () => {
    expect(shortfall({ count: NEIGHBOURS_THAT_FIT * 2, state: 'idle' })).toBe(0);
  });
});

const A_GIB_IN_MIB = 1024;
/** What an m8id.large reports once the kernel has taken its own share of the 8 GiB it is sold as. */
const HOST_MIB = 7779;
const ZEROFS_CACHE_MIB = 2 * A_GIB_IN_MIB;
/** `HOST_BASELINE_MIB`, restated so that moving it has to be a deliberate edit in two places. */
const HOST_BASELINE_MIB = 640;

/**
 * The host's own needs come off the top before anything is placed. Reporting the whole of an
 * instance's RAM as capacity is what let a host admit more microVMs than it could carry — and a
 * guest that does not fit is not refused but killed, along with whichever neighbour the kernel
 * picks instead.
 */
describe('memory the host needs is not memory a guest may be given', () => {
  test('what is left is the total less what ZeroFS will grow into, less the host itself', () => {
    expect(guestMemoryMib({ hostMemoryMib: HOST_MIB, zerofsCacheMib: ZEROFS_CACHE_MIB })).toBe(
      HOST_MIB - ZEROFS_CACHE_MIB - HOST_BASELINE_MIB,
    );
  });

  test('a bigger ZeroFS cache is memory the guests do not get', () => {
    const roomier = guestMemoryMib({ hostMemoryMib: HOST_MIB, zerofsCacheMib: ZEROFS_CACHE_MIB });
    const tighter = guestMemoryMib({
      hostMemoryMib: HOST_MIB,
      zerofsCacheMib: ZEROFS_CACHE_MIB + A_GIB_IN_MIB,
    });

    expect(roomier - tighter).toBe(A_GIB_IN_MIB);
  });

  // Floored rather than negative: an oversubscribed host is a fact to report, and a shortfall
  // computed against a negative total would read as room.
  test('a host too small for what is already spoken for offers nothing rather than less', () => {
    expect(guestMemoryMib({ hostMemoryMib: 512, zerofsCacheMib: ZEROFS_CACHE_MIB })).toBe(0);
  });

  test('and it is the number a wake is refused on, so the two cannot drift apart', () => {
    const available = guestMemoryMib({
      hostMemoryMib: HOST_MIB,
      zerofsCacheMib: ZEROFS_CACHE_MIB,
    });
    const fits = Math.floor(available / APP_MEMORY_MIB);

    expect(
      memoryShortfallMib({
        hostMemoryMib: available,
        committed: committedResources(neighbours({ count: fits, state: 'running' })),
        wanted: DEFAULT_INSTANCE_RESOURCES,
      }),
    ).toBeGreaterThan(0);
  });
});
