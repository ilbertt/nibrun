import { describe, expect, test } from 'bun:test';
import { type AppId, AppIdSchema, HostPortSchema, Ipv4AddressSchema, Value } from '@repo/protocol';
import { Effect, Either, Layer, Option } from 'effect';
import { assignmentsFrom, readSlotRecords, type SlotRecords } from '#lib/network/allocator.ts';
import {
  describeSlot,
  EXTRA_PUBLIC_PORT_BASE,
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

  test('a released slot becomes available again', async () => {
    const [released, reused] = await withAllocator((allocator) =>
      Effect.gen(function* () {
        const first = yield* allocator.allocate(app(1));
        yield* allocator.release(app(1));
        const gone = yield* allocator.lookup(app(1));
        const next = yield* allocator.allocate(app(2));
        return [Option.isNone(gone) ? first.slot : -1, next.slot];
      }).pipe(Effect.orDie),
    );
    expect(reused).toBe(released as number);
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
