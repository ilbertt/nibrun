import { describe, expect, test } from 'bun:test';
import {
  type AppId,
  AppIdSchema,
  type FilesystemUsage,
  type Timestamp,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { Effect, Layer } from 'effect';
import { measureUsage } from '#lib/agent/usage.ts';
import { AgentState } from '#services/agent-state.service.ts';
import {
  FilesystemReader,
  type GuestReading,
  type MeasuredComputeAt,
  NoDeviceForApp,
} from '#services/filesystem-reader.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { instanceRecord } from '#tests/support/fixtures.ts';
import { platform } from '#tests/support/run.ts';

const BUSY = Value.Parse(AppIdSchema, 'app-pocketbase');
const QUIET = Value.Parse(AppIdSchema, 'app-minio');

function at(value: string): Timestamp {
  return Value.Parse(TimestampSchema, value);
}

/** An 8 GiB volume as ext4 accounts for it, a tenant with data on it, and one with none. */
const TOTAL_BYTES = 8_455_712_768;
const FILLED_BYTES = 1_503_238_553;
const EMPTY_BYTES = 4_096;

/** A gibibyte of guest memory as the guest kernel counts it, and what a tenant has of it. */
const MEMORY_TOTAL_BYTES = 1_031_012_352;
const MEMORY_USED_BYTES = 412_401_664;

/** Two readings a quarter of an interval apart: 100 busy ticks out of 400 elapsed. */
const FIRST_TOTAL_TICKS = 1_000;
const FIRST_BUSY_TICKS = 100;
const SECOND_TOTAL_TICKS = 1_400;
const SECOND_BUSY_TICKS = 200;
const EXPECTED_SHARE = 0.25;

function filesystem(usedBytes: number): FilesystemUsage {
  return { totalBytes: TOTAL_BYTES, usedBytes, measuredAt: at('2026-08-03T10:00:00Z') };
}

function compute({ total, busy }: { total: number; busy: number }): MeasuredComputeAt {
  return {
    memoryTotalBytes: MEMORY_TOTAL_BYTES,
    memoryUsedBytes: MEMORY_USED_BYTES,
    cpuTotalTicks: total,
    cpuBusyTicks: busy,
    measuredAt: at('2026-08-03T10:00:00Z'),
  };
}

const FIRST_PASS = compute({ total: FIRST_TOTAL_TICKS, busy: FIRST_BUSY_TICKS });
const SECOND_PASS = compute({ total: SECOND_TOTAL_TICKS, busy: SECOND_BUSY_TICKS });

function reading(both: Partial<GuestReading> = {}): GuestReading {
  return { filesystem: both.filesystem, compute: both.compute };
}

/**
 * The real allocator over a slots file nothing wrote, so the slots a test cares about are the
 * ones it allocates — and `persist`, which would write to a directory that does not exist, is
 * never what a measurement reaches.
 */
const host = Layer.mergeAll(agentConfig(), platform);
const slots = Layer.provide(SlotAllocator.DefaultWithoutDependencies, host);

/** Answers with whatever the test put in front of it, and refuses the apps it was given none for. */
function measuring(readings: ReadonlyMap<AppId, GuestReading>) {
  return Layer.succeed(
    FilesystemReader,
    FilesystemReader.make({
      list: () => Effect.die('nothing lists a directory here'),
      measure: ({ appId }) => {
        const taken = readings.get(appId);
        return taken ? Effect.succeed(taken) : new NoDeviceForApp({ appId });
      },
    }),
  );
}

function run<A, E>(input: {
  readings: ReadonlyMap<AppId, GuestReading>;
  program: Effect.Effect<A, E, AgentState | SlotAllocator | FilesystemReader>;
}) {
  return Effect.runPromise(
    Effect.provide(
      input.program,
      Layer.mergeAll(AgentState.Default, slots, measuring(input.readings)),
    ),
  );
}

describe('every guest this host holds is measured on a pass of its own', () => {
  test('a reading is taken for each app holding a slot', async () => {
    const snapshot = await run({
      readings: new Map([
        [BUSY, reading({ filesystem: filesystem(FILLED_BYTES), compute: FIRST_PASS })],
        [QUIET, reading({ filesystem: filesystem(EMPTY_BYTES), compute: FIRST_PASS })],
      ]),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* allocator.allocate(QUIET);
        yield* measureUsage;
        return yield* AgentState.snapshot;
      }),
    });

    expect(snapshot.volumeUsage.get(BUSY)?.usedBytes).toBe(FILLED_BYTES);
    expect(snapshot.volumeUsage.get(QUIET)?.usedBytes).toBe(EMPTY_BYTES);
    expect(snapshot.computeUsage.get(BUSY)?.memoryUsedBytes).toBe(MEMORY_USED_BYTES);
    expect(snapshot.computeUsage.get(QUIET)?.memoryUsedBytes).toBe(MEMORY_USED_BYTES);
  });

  /**
   * A slot outlives the microVM, so this is what a suspended app looks like: nothing has the
   * filesystem mounted, nothing can be asked, and the honest answer is what was true when it was
   * last running rather than nothing at all.
   */
  test('an app whose guest cannot be asked keeps the readings it had', async () => {
    const snapshot = await run({
      readings: new Map([
        [BUSY, reading({ filesystem: filesystem(FILLED_BYTES), compute: FIRST_PASS })],
      ]),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* measureUsage;
        // The same pass again against a reader that has since stopped answering for it.
        yield* Effect.provide(measureUsage, measuring(new Map()));
        return yield* AgentState.snapshot;
      }),
    });

    expect(snapshot.volumeUsage.get(BUSY)).toEqual(filesystem(FILLED_BYTES));
    expect(snapshot.computeUsage.get(BUSY)?.memoryUsedBytes).toBe(MEMORY_USED_BYTES);
  });

  /**
   * The exception, and the difference is whether there is a microVM at all. A suspended app was
   * taken offline by an owner who may want to know what it was doing; an `on-request` app sleeps
   * and wakes on its own, and a figure carried across every sleep would have one holding nothing
   * go on reporting what it held when it last ran.
   */
  test('an app asleep between requests forgets what it was spending', async () => {
    const snapshot = await run({
      readings: new Map([
        [BUSY, reading({ filesystem: filesystem(FILLED_BYTES), compute: FIRST_PASS })],
      ]),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* measureUsage;
        yield* AgentState.putRecord(
          instanceRecord({ appId: BUSY, onRequest: true, state: 'idle' }),
        );
        // The same pass again, with the guest gone the way a sleeping app's is.
        yield* Effect.provide(measureUsage, measuring(new Map()));
        return yield* AgentState.snapshot;
      }),
    });

    expect(snapshot.computeUsage.has(BUSY)).toBe(false);
    expect(snapshot.computeTicks.has(BUSY)).toBe(false);
    // The volume is untouched: a filesystem is still there when the microVM holding it is not.
    expect(snapshot.volumeUsage.get(BUSY)).toEqual(filesystem(FILLED_BYTES));
  });

  // The slot goes when the control plane says the volume is absent, which is the one moment the
  // readings stop being about anything.
  test('an app that has lost its slot is not carried forward', async () => {
    const snapshot = await run({
      readings: new Map([
        [BUSY, reading({ filesystem: filesystem(FILLED_BYTES), compute: FIRST_PASS })],
      ]),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* measureUsage;
        yield* allocator.release(BUSY);
        yield* measureUsage;
        return yield* AgentState.snapshot;
      }),
    });

    expect(snapshot.volumeUsage.has(BUSY)).toBe(false);
    expect(snapshot.computeUsage.has(BUSY)).toBe(false);
    expect(snapshot.computeTicks.has(BUSY)).toBe(false);
  });

  // Nobody is waiting on a measurement, and the report it feeds must go out regardless.
  test('a guest that will not answer is not a failure of the pass', async () => {
    const snapshot = await run({
      readings: new Map(),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* measureUsage;
        return yield* AgentState.snapshot;
      }),
    });

    expect(snapshot.volumeUsage.size).toBe(0);
    expect(snapshot.computeUsage.size).toBe(0);
  });

  /**
   * The two halves are two exchanges, and a guest whose image predates one of the verbs refuses
   * that one and answers the other — which is what every host looks like between this shipping
   * and the guest image release behind it.
   */
  test('a guest that answers about only one of the two is reported on that one', async () => {
    const snapshot = await run({
      readings: new Map([[BUSY, reading({ filesystem: filesystem(FILLED_BYTES) })]]),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* measureUsage;
        return yield* AgentState.snapshot;
      }),
    });

    expect(snapshot.volumeUsage.get(BUSY)?.usedBytes).toBe(FILLED_BYTES);
    expect(snapshot.computeUsage.has(BUSY)).toBe(false);
  });
});

describe('a cpu share is what happened between two readings', () => {
  function overTwoPasses(second: MeasuredComputeAt) {
    return run({
      readings: new Map([[BUSY, reading({ compute: FIRST_PASS })]]),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* measureUsage;
        const first = (yield* AgentState.snapshot).computeUsage.get(BUSY);
        yield* Effect.provide(
          measureUsage,
          measuring(new Map([[BUSY, reading({ compute: second })]])),
        );
        return { first, after: (yield* AgentState.snapshot).computeUsage.get(BUSY) };
      }),
    });
  }

  // Memory is a level and arrives whole on the first reading; the share is a rate and cannot.
  test('the first reading after an agent starts has nothing to have been a rate since', async () => {
    const { first, after } = await overTwoPasses(SECOND_PASS);

    expect(first?.memoryUsedBytes).toBe(MEMORY_USED_BYTES);
    expect(first?.cpuShare).toBeUndefined();
    expect(after?.cpuShare).toBe(EXPECTED_SHARE);
  });

  /**
   * The counters are since the guest booted, so a reading standing behind the one before it is a
   * guest that is not the same guest any more. Dividing by that difference reads a reboot as a
   * negative rate, and a made-up nought is the number an owner would act on.
   */
  test('a guest that has rebooted since is not measured against what it was', async () => {
    const { after } = await overTwoPasses(
      compute({ total: FIRST_TOTAL_TICKS / 2, busy: FIRST_BUSY_TICKS / 2 }),
    );

    expect(after?.cpuShare).toBeUndefined();
    expect(after?.memoryUsedBytes).toBe(MEMORY_USED_BYTES);
  });
});
