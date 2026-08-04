import { describe, expect, test } from 'bun:test';
import type { AppId, HostPort, Ipv4Address } from '@repo/protocol';
import { Effect, Either, Layer, Option } from 'effect';
import { AgentConfig } from '#config.ts';
import {
  assignmentsFrom,
  readSlotRecords,
  SlotAllocator,
  type SlotRecords,
} from '#network/allocator.ts';
import { describeSlot, HOST_PORT_BASE, SLOT_COUNT } from '#network/slot.ts';
import { platform } from '#testing.ts';

const app = (name: string | number) => `app-${name}` as AppId;

const SUBNET_PREFIX_LENGTH = 30;
const BOUNDARY_SLOT = 64;
const SOME_SLOT = 3;
const DISTINCT_APPS = ['alpha', 'beta', 'gamma'];
const BEYOND_THE_LAST_SLOT = 1_000;
const everySlot = [...Array(SLOT_COUNT).keys()];

// A directory nothing writes to: the allocator starts empty and never persists during a test.
const config = Layer.succeed(AgentConfig, {
  slotsFile: '/nonexistent/nibrun-test/slots.json',
} as AgentConfig);

const withAllocator = <A>(use: (allocator: SlotAllocator) => Effect.Effect<A, never, never>) =>
  Effect.runPromise(
    Effect.flatMap(SlotAllocator, use).pipe(
      Effect.provide(SlotAllocator.Default.pipe(Layer.provide(Layer.merge(config, platform)))),
    ),
  );

describe('slot derivation', () => {
  test('every per-app resource comes from the one number', () => {
    expect(describeSlot({ slot: 0, appId: app(0) })).toEqual({
      slot: 0,
      appId: app(0),
      hostPort: HOST_PORT_BASE as HostPort,
      hostIpv4: '10.201.0.1' as Ipv4Address,
      guestIpv4: '10.201.0.2' as Ipv4Address,
      guestMac: '02:00:0a:c9:00:02',
      tapName: 'nbr0',
      nbdDevicePath: '/dev/nbd0',
      subnetPrefixLength: SUBNET_PREFIX_LENGTH,
    });
  });

  test('slots do not overlap', () => {
    const first = describeSlot({ slot: 0, appId: app(0) });
    const second = describeSlot({ slot: 1, appId: app(1) });
    expect(second.hostIpv4).toBe('10.201.0.5' as Ipv4Address);
    expect(second.guestIpv4).toBe('10.201.0.6' as Ipv4Address);
    expect(second.hostPort).toBe((first.hostPort + 1) as HostPort);
  });

  test('addressing carries past an octet boundary', () => {
    expect(describeSlot({ slot: BOUNDARY_SLOT, appId: app(BOUNDARY_SLOT) }).guestIpv4).toBe(
      '10.201.1.2' as Ipv4Address,
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
    expect(ports[0]).toBe(ports[1] as HostPort);
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
  const slotOf = ({ records, appId }: { records: SlotRecords; appId: AppId }) =>
    assignmentsFrom(records).get(appId);

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
