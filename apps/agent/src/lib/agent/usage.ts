import type { AppId, FilesystemUsage } from '@repo/protocol';
import { type Duration, Effect, Schedule } from 'effect';
import { supervised } from '#lib/agent/loop.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { FilesystemReader } from '#services/filesystem-reader.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

/**
 * How often each volume this host holds is measured.
 *
 * Slower than the report it rides on, because a filesystem fills at the speed a tenant writes and
 * nobody is waiting on this the way they wait on a listing. What it buys at this interval is one
 * connection per app per minute, against one per app per report — and each of those costs the
 * guest a forked worker, which is a cost the tenant pays.
 */
const MEASUREMENT_INTERVAL: Duration.DurationInput = '1 minute';

/**
 * Enough to stop one guest that has stopped answering from holding up the rest, and low enough
 * that a packed host is not opening a connection into every tenant it runs at once.
 */
const MEASUREMENT_CONCURRENCY = 4;

/**
 * What every volume with a slot on this host currently measures, keeping the last reading for one
 * that could not be asked.
 *
 * A slot outlives the microVM, so this is also what a suspended app keeps: it stopped, its guest
 * went with it, and the honest answer about its filesystem is what was true when it was last
 * running rather than nothing at all. The reading carries the moment it was taken, which is what
 * lets whoever reads it tell the two apart.
 */
export const measureVolumes = Effect.gen(function* () {
  const allocator = yield* SlotAllocator;
  const reader = yield* FilesystemReader;
  const previous = (yield* AgentState.snapshot).volumeUsage;

  const measured = yield* Effect.forEach(
    yield* allocator.slots,
    (slot) =>
      reader.usage({ appId: slot.appId }).pipe(
        Effect.catchAll((error) =>
          Effect.logDebug('volume usage could not be measured', error).pipe(
            Effect.annotateLogs({ appId: slot.appId }),
            Effect.as(previous.get(slot.appId)),
          ),
        ),
        Effect.map((usage) => [slot.appId, usage] as const),
      ),
    { concurrency: MEASUREMENT_CONCURRENCY },
  );

  yield* AgentState.setVolumeUsage(
    new Map(
      measured.filter((reading): reading is readonly [AppId, FilesystemUsage] => !!reading[1]),
    ),
  );
});

/**
 * The sixth loop, and separate from the report it feeds for the reason the filesystem loop is
 * separate from the reconcile: measuring means a round trip into every guest on the host, and a
 * report that waited for those would be a report a hung tenant could stop — while what the report
 * carries otherwise is what the control plane converges a deploy on.
 */
export const volumeUsageLoop = supervised({
  once: Effect.andThen(measureVolumes, Effect.sleep(MEASUREMENT_INTERVAL)),
  onFailure: (cause) => Effect.logWarning('volume usage loop failed', cause),
  schedule: Schedule.spaced(MEASUREMENT_INTERVAL),
});
