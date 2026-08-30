import type { AppId, ComputeUsage, FilesystemUsage } from '@repo/protocol';
import { type Duration, Effect, Schedule } from 'effect';
import { recordActivity } from '#lib/agent/activity.ts';
import { supervised } from '#lib/agent/loop.ts';
import type { MeasuredCompute } from '#lib/filesystem/protocol.ts';
import { applySleep } from '#lib/reconcile/idle.ts';
import { type AgentSnapshot, AgentState } from '#services/agent-state.service.ts';
import { FilesystemReader, type GuestReading } from '#services/filesystem-reader.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

/**
 * How often each guest this host runs is measured.
 *
 * Slower than the report it rides on, because a filesystem fills at the speed a tenant writes and
 * nobody is waiting on this the way they wait on a listing. What it buys at this interval is one
 * connection per app per minute, against one per app per report — and each of those costs the
 * guest a forked worker, which is a cost the tenant pays.
 *
 * It is also the window every CPU share is averaged over, which is what that figure means and the
 * reason it is not the same question as what an app is doing right now: a minute of one vCPU
 * pinned and three idle reads the same as four vCPUs busy for fifteen seconds.
 */
const MEASUREMENT_INTERVAL: Duration.DurationInput = '1 minute';

/**
 * Enough to stop one guest that has stopped answering from holding up the rest, and low enough
 * that a packed host is not opening a connection into every tenant it runs at once.
 */
const MEASUREMENT_CONCURRENCY = 4;

/** Every vCPU the app was given, busy. Two saturated vCPUs is this, not twice it. */
const FULLY_BUSY = 1;

type Taken = { readonly appId: AppId; readonly reading: GuestReading | undefined };

/**
 * The share of the vCPUs spent computing between two readings.
 *
 * Missing rather than zero where there is nothing to compare against: the counters are cumulative
 * since the guest booted, so the first reading after an agent starts has no interval behind it,
 * and one standing behind the reading before it is a guest that has rebooted since. Both would
 * divide by a difference that is not an interval, and a made-up nought is the reading an owner
 * would act on.
 */
function shareBetween({
  before,
  after,
}: {
  before: MeasuredCompute | undefined;
  after: MeasuredCompute;
}): number | undefined {
  if (before === undefined) {
    return undefined;
  }
  const total = after.cpuTotalTicks - before.cpuTotalTicks;
  const busy = after.cpuBusyTicks - before.cpuBusyTicks;
  return total <= 0 || busy < 0 ? undefined : Math.min(busy / total, FULLY_BUSY);
}

function asComputeUsage({
  measured,
  before,
}: {
  measured: NonNullable<GuestReading['compute']>;
  before: MeasuredCompute | undefined;
}): ComputeUsage {
  const cpuShare = shareBetween({ before, after: measured });
  return {
    memoryTotalBytes: measured.memoryTotalBytes,
    memoryUsedBytes: measured.memoryUsedBytes,
    ...(cpuShare === undefined ? {} : { cpuShare }),
    measuredAt: measured.measuredAt,
  };
}

function volumeUsageAfter({
  taken,
  previous,
}: {
  taken: readonly Taken[];
  previous: AgentSnapshot;
}): ReadonlyMap<AppId, FilesystemUsage> {
  const usage = new Map<AppId, FilesystemUsage>();
  for (const { appId, reading } of taken) {
    const measured = reading?.filesystem ?? previous.volumeUsage.get(appId);
    if (measured) {
      usage.set(appId, measured);
    }
  }
  return usage;
}

function computeUsageAfter({
  taken,
  previous,
}: {
  taken: readonly Taken[];
  previous: AgentSnapshot;
}) {
  const compute = new Map<AppId, ComputeUsage>();
  const ticks = new Map<AppId, MeasuredCompute>();
  for (const { appId, reading } of taken) {
    const before = previous.computeTicks.get(appId);
    const measured = reading?.compute;
    if (measured === undefined) {
      const kept = previous.computeUsage.get(appId);
      if (kept) {
        compute.set(appId, kept);
      }
      if (before) {
        ticks.set(appId, before);
      }
      continue;
    }
    compute.set(appId, asComputeUsage({ measured, before }));
    ticks.set(appId, measured);
  }
  return { compute, ticks };
}

/**
 * What every guest with a slot on this host currently measures, keeping the last reading for one
 * that could not be asked.
 *
 * A slot outlives the microVM, so this is also what a suspended app keeps: it stopped, its guest
 * went with it, and the honest answer about it is what was true when it was last running rather
 * than nothing at all. Each reading carries the moment it was taken, which is what lets whoever
 * reads it tell the two apart.
 */
export const measureUsage = Effect.gen(function* () {
  const allocator = yield* SlotAllocator;
  const reader = yield* FilesystemReader;
  const previous = yield* AgentState.snapshot;

  const taken = yield* Effect.forEach(
    yield* allocator.slots,
    (slot) =>
      reader.measure({ appId: slot.appId }).pipe(
        Effect.catchAll((error) =>
          Effect.logDebug('a guest could not be measured', error).pipe(
            Effect.annotateLogs({ appId: slot.appId }),
            Effect.as(undefined),
          ),
        ),
        Effect.map((reading) => ({ appId: slot.appId, reading }) satisfies Taken),
      ),
    { concurrency: MEASUREMENT_CONCURRENCY },
  );

  yield* AgentState.setUsage({
    volumes: volumeUsageAfter({ taken, previous }),
    ...computeUsageAfter({ taken, previous }),
  });
});

/**
 * The sixth loop, and separate from the report it feeds for the reason the filesystem loop is
 * separate from the reconcile: measuring means a round trip into every guest on the host, and a
 * report that waited for those would be a report a hung tenant could stop — while what the report
 * carries otherwise is what the control plane converges a deploy on.
 */
export const usageLoop = supervised({
  // Deciding straight after measuring, because the measurement is the only thing that moves the
  // answer: an app is let go to sleep on the reading that found it quiet rather than on a tick
  // that happened to come later.
  once: Effect.andThen(
    Effect.andThen(recordActivity, Effect.andThen(applySleep, measureUsage)),
    Effect.sleep(MEASUREMENT_INTERVAL),
  ),
  onFailure: (cause) => Effect.logWarning('the usage loop failed', cause),
  schedule: Schedule.spaced(MEASUREMENT_INTERVAL),
});
