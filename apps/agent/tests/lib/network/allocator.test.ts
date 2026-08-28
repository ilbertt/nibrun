import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AppId, AppIdSchema, HostPortSchema, Ipv4AddressSchema, Value } from '@repo/protocol';
import { Effect, Either, Layer, Option } from 'effect';
import {
  assignmentsFrom,
  readSlotCursor,
  readSlotRecords,
  type SlotRecords,
} from '#lib/network/allocator.ts';
import {
  describeSlot,
  EXTRA_PUBLIC_PORT_BASE,
  FIRST_SLOT,
  HOST_PORT_BASE,
  SLOT_COUNT,
} from '#lib/network/slot.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { platform, provided } from '#tests/support/run.ts';

const SUBNET_PREFIX_LENGTH = 30;
const BOUNDARY_SLOT = 64;
const SOME_SLOT = 3;
const DISTINCT_APPS = ['alpha', 'beta', 'gamma'];
const BEYOND_THE_LAST_SLOT = 1_000;
const NOT_A_WHOLE_NUMBER = 1.5;

/** Where the cursor would sit had the slot just handed out moved it. */
function wouldBeNext(slot: number): number {
  return slot + 1;
}
const everySlot = [...Array(SLOT_COUNT).keys()];

const run = provided(
  SlotAllocator.DefaultWithoutDependencies.pipe(
    Layer.provide(Layer.merge(agentConfig(), platform)),
  ),
);

function app(name: string | number) {
  return Value.Parse(AppIdSchema, `app-${name}`);
}

function withAllocator<A, E>(use: (allocator: SlotAllocator) => Effect.Effect<A, E>) {
  return run(Effect.flatMap(SlotAllocator, use));
}

describe('slot derivation', () => {
  test('every per-app resource comes from the one number', () => {
    expect(describeSlot({ slot: 0, appId: app(0) })).toEqual({
      slot: 0,
      appId: app(0),
      hostPort: Value.Parse(HostPortSchema, HOST_PORT_BASE),
      extraPublicPort: Value.Parse(HostPortSchema, EXTRA_PUBLIC_PORT_BASE),
      hostIpv4: Value.Parse(Ipv4AddressSchema, '10.201.0.1'),
      guestIpv4: Value.Parse(Ipv4AddressSchema, '10.201.0.2'),
      guestMac: '02:00:0a:c9:00:02',
      tapName: 'nbr0',
      nbdDevicePath: '/dev/nbd0',
      subnetPrefixLength: SUBNET_PREFIX_LENGTH,
    });
  });

  test('slots do not overlap', () => {
    const first = describeSlot({ slot: 0, appId: app(0) });
    const second = describeSlot({ slot: 1, appId: app(1) });
    expect(second.hostIpv4).toBe(Value.Parse(Ipv4AddressSchema, '10.201.0.5'));
    expect(second.guestIpv4).toBe(Value.Parse(Ipv4AddressSchema, '10.201.0.6'));
    expect(second.hostPort).toBe(Value.Parse(HostPortSchema, first.hostPort + 1));
  });

  test('addressing carries past an octet boundary', () => {
    expect(describeSlot({ slot: BOUNDARY_SLOT, appId: app(BOUNDARY_SLOT) }).guestIpv4).toBe(
      Value.Parse(Ipv4AddressSchema, '10.201.1.2'),
    );
  });
});

describe('allocation is stable for the lifetime of an app', () => {
  test('a redeploy keeps the host port, which is what makes it invisible to routing', async () => {
    const ports = await withAllocator((allocator) =>
      Effect.gen(function* () {
        const first = yield* allocator.allocate(app(1));
        const second = yield* allocator.allocate(app(1));
        return [first.hostPort, second.hostPort];
      }).pipe(Effect.orDie),
    );
    expect(ports[0]).toBe(Value.Parse(HostPortSchema, ports[1]));
  });

  test('distinct apps never share a slot', async () => {
    const ports = await withAllocator((allocator) =>
      Effect.forEach(DISTINCT_APPS, (name) =>
        Effect.map(allocator.allocate(app(name)), (slot) => slot.hostPort),
      ).pipe(Effect.orDie),
    );
    expect(new Set(ports).size).toBe(DISTINCT_APPS.length);
  });

  // Asserted against a full host rather than an empty one: the freed slot is then the only one
  // left, so this says the pool grew back without saying which order it is drawn from.
  test('a released slot becomes available again', async () => {
    const [released, reused] = await withAllocator((allocator) =>
      Effect.gen(function* () {
        yield* Effect.forEach(everySlot, (index) => allocator.allocate(app(index)), {
          discard: true,
        });
        const freed = yield* allocator.allocate(app(SOME_SLOT));
        yield* allocator.release(app(SOME_SLOT));
        const gone = yield* allocator.lookup(app(SOME_SLOT));
        const next = yield* allocator.allocate(app(BEYOND_THE_LAST_SLOT));
        return [Option.isNone(gone) ? freed.slot : -1, next.slot];
      }).pipe(Effect.orDie),
    );
    expect(reused).toBe(released as number);
  });

  /**
   * The address a tenant hands its own users is this slot's, and a slot handed straight back out
   * is that address pointing at somebody else. Every other slot goes first, which on a host with
   * room is every allocation between now and the cursor coming round.
   */
  test('a released slot is not the next one handed out', async () => {
    const [released, next] = await withAllocator((allocator) =>
      Effect.gen(function* () {
        const first = yield* allocator.allocate(app(1));
        yield* allocator.release(app(1));
        const second = yield* allocator.allocate(app(2));
        return [first.slot, second.slot];
      }).pipe(Effect.orDie),
    );
    expect(next).not.toBe(released);
  });

  // A redeploy asks for a slot the app already holds. Moving the cursor there would park it
  // wherever the busiest app happens to sit, and a slot freed beside it would go straight back out.
  test('being handed the slot an app already holds does not move the cursor', async () => {
    const [released, next] = await withAllocator((allocator) =>
      Effect.gen(function* () {
        const staying = yield* allocator.allocate(app('staying'));
        yield* allocator.allocate(app('leaving'));
        yield* allocator.release(app('leaving'));
        // The redeploy: an app asking again for the slot it never gave up.
        yield* allocator.allocate(app('staying'));
        const arriving = yield* allocator.allocate(app('arriving'));
        return [wouldBeNext(staying.slot), arriving.slot];
      }).pipe(Effect.orDie),
    );
    expect(next).not.toBe(released);
  });

  test('running out of slots is a typed failure, not a silent reuse', async () => {
    const exhausted = await withAllocator((allocator) =>
      Effect.gen(function* () {
        yield* Effect.forEach(everySlot, (index) => allocator.allocate(app(index)), {
          discard: true,
        }).pipe(Effect.orDie);
        return yield* Effect.either(allocator.allocate(app(BEYOND_THE_LAST_SLOT)));
      }),
    );
    expect(Either.isLeft(exhausted) && exhausted.left._tag).toBe('SlotExhausted');
  });
});

/**
 * The cursor is a hint and the scan is the authority: it decides where to start looking, never
 * what may be handed out. Nothing a file holds can make this give away a slot another app has.
 */
describe('a cursor read off disk cannot hand out a slot somebody holds', () => {
  test('anything that is not a whole number starts at the first slot', () => {
    expect(readSlotCursor(undefined)).toBe(FIRST_SLOT);
    expect(readSlotCursor(null)).toBe(FIRST_SLOT);
    expect(readSlotCursor('7')).toBe(FIRST_SLOT);
    expect(readSlotCursor(NOT_A_WHOLE_NUMBER)).toBe(FIRST_SLOT);
    expect(readSlotCursor(SOME_SLOT)).toBe(SOME_SLOT);
  });

  test.each([BEYOND_THE_LAST_SLOT, -BEYOND_THE_LAST_SLOT])(
    'a cursor of %s still lands on a slot this host has',
    async (cursor) => {
      const file = join(tmpdir(), `nibrun-cursor-${cursor}.json`);
      await Bun.write(file, JSON.stringify(cursor));
      const slot = await provided(
        SlotAllocator.DefaultWithoutDependencies.pipe(
          Layer.provide(Layer.merge(agentConfig({ slotCursorFile: file }), platform)),
        ),
      )(
        Effect.flatMap(SlotAllocator, (allocator) => allocator.allocate(app(1))).pipe(Effect.orDie),
      );

      expect(slot.slot).toBeGreaterThanOrEqual(FIRST_SLOT);
      expect(slot.slot).toBeLessThan(SLOT_COUNT);
    },
  );
});

describe('allocation survives an agent restart', () => {
  function slotOf({ records, appId }: { records: SlotRecords; appId: AppId }) {
    return assignmentsFrom(records).get(appId);
  }

  test('a corrupted record file degrades to an empty allocator rather than throwing', () => {
    expect(readSlotRecords('nonsense')).toEqual({});
    expect(readSlotRecords({ 'app-1': 'three', 'app-2': SOME_SLOT })).toEqual({
      'app-2': SOME_SLOT,
    });
  });

  test('duplicate slots in a persisted file are not both honoured', () => {
    const records = { 'app-1': SOME_SLOT, 'app-2': SOME_SLOT };
    expect(slotOf({ records, appId: app(1) })).toBe(SOME_SLOT);
    expect(slotOf({ records, appId: app(2) })).toBeUndefined();
  });

  test('a slot outside the host limit is dropped', () => {
    expect(slotOf({ records: { 'app-1': SLOT_COUNT }, appId: app(1) })).toBeUndefined();
  });
});
