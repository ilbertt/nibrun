import { describe, expect, test } from 'bun:test';
import {
  type AppId,
  AppIdSchema,
  type FilesystemUsage,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { Effect, Layer } from 'effect';
import { measureVolumes } from '#lib/agent/usage.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { FilesystemReader, NoDeviceForApp } from '#services/filesystem-reader.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { platform } from '#tests/support/run.ts';

const BUSY = Value.Parse(AppIdSchema, 'app-pocketbase');
const QUIET = Value.Parse(AppIdSchema, 'app-minio');

const AT = (value: string) => Value.Parse(TimestampSchema, value);

/** An 8 GiB volume as ext4 accounts for it, a tenant with data on it, and one with none. */
const TOTAL_BYTES = 8_455_712_768;
const FILLED_BYTES = 1_503_238_553;
const EMPTY_BYTES = 4_096;

function reading(usedBytes: number): FilesystemUsage {
  return { totalBytes: TOTAL_BYTES, usedBytes, measuredAt: AT('2026-08-03T10:00:00Z') };
}

/**
 * The real allocator over a slots file nothing wrote, so the slots a test cares about are the
 * ones it allocates — and `persist`, which would write to a directory that does not exist, is
 * never what a measurement reaches.
 */
const host = Layer.mergeAll(agentConfig(), platform);
const slots = Layer.provide(SlotAllocator.DefaultWithoutDependencies, host);

/** Answers with whatever the test put in front of it, and refuses the apps it was given none for. */
function measuring(readings: ReadonlyMap<AppId, FilesystemUsage>) {
  return Layer.succeed(
    FilesystemReader,
    FilesystemReader.make({
      list: () => Effect.die('nothing lists a directory here'),
      usage: ({ appId }) => {
        const measured = readings.get(appId);
        return measured ? Effect.succeed(measured) : new NoDeviceForApp({ appId });
      },
    }),
  );
}

function run<A, E>(input: {
  readings: ReadonlyMap<AppId, FilesystemUsage>;
  program: Effect.Effect<A, E, AgentState | SlotAllocator | FilesystemReader>;
}) {
  return Effect.runPromise(
    Effect.provide(
      input.program,
      Layer.mergeAll(AgentState.Default, slots, measuring(input.readings)),
    ),
  );
}

describe('every volume this host holds is measured on a pass of its own', () => {
  test('a reading is taken for each app holding a slot', async () => {
    const usage = await run({
      readings: new Map([
        [BUSY, reading(FILLED_BYTES)],
        [QUIET, reading(EMPTY_BYTES)],
      ]),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* allocator.allocate(QUIET);
        yield* measureVolumes;
        return (yield* AgentState.snapshot).volumeUsage;
      }),
    });

    expect(usage.get(BUSY)?.usedBytes).toBe(FILLED_BYTES);
    expect(usage.get(QUIET)?.usedBytes).toBe(EMPTY_BYTES);
  });

  /**
   * A slot outlives the microVM, so this is what a suspended app looks like: nothing has the
   * filesystem mounted, nothing can be asked, and the honest answer is what was true when it was
   * last running rather than nothing at all.
   */
  test('an app whose guest cannot be asked keeps the reading it had', async () => {
    const usage = await run({
      readings: new Map([[BUSY, reading(FILLED_BYTES)]]),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* measureVolumes;
        // The same pass again against a reader that has since stopped answering for it.
        yield* Effect.provide(measureVolumes, measuring(new Map()));
        return (yield* AgentState.snapshot).volumeUsage;
      }),
    });

    expect(usage.get(BUSY)).toEqual(reading(FILLED_BYTES));
  });

  // The slot goes when the control plane says the volume is absent, which is the one moment the
  // reading stops being about anything.
  test('an app that has lost its slot is not carried forward', async () => {
    const usage = await run({
      readings: new Map([[BUSY, reading(FILLED_BYTES)]]),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* measureVolumes;
        yield* allocator.release(BUSY);
        yield* measureVolumes;
        return (yield* AgentState.snapshot).volumeUsage;
      }),
    });

    expect(usage.has(BUSY)).toBe(false);
  });

  // Nobody is waiting on a measurement, and the report it feeds must go out regardless.
  test('a guest that will not answer is not a failure of the pass', async () => {
    const usage = await run({
      readings: new Map(),
      program: Effect.gen(function* () {
        const allocator = yield* SlotAllocator;
        yield* allocator.allocate(BUSY);
        yield* measureVolumes;
        return (yield* AgentState.snapshot).volumeUsage;
      }),
    });

    expect(usage.size).toBe(0);
  });
});
