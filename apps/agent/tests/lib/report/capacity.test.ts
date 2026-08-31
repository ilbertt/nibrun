import { describe, expect, test } from 'bun:test';
import { AppIdSchema, DEFAULT_INSTANCE_RESOURCES, type InstanceState, Value } from '@repo/protocol';
import { committedResources, memoryShortfallMib } from '#lib/report/capacity.ts';
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
