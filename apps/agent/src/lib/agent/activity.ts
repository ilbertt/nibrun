import { type AppId, AppIdSchema, isValidMessage, Value } from '@repo/protocol';
import { Clock, Effect } from 'effect';
import type { AppTraffic } from '#lib/network/counters.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { HostFirewall } from '#services/host-firewall.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

export type Activity = {
  readonly traffic: ReadonlyMap<AppId, AppTraffic>;
  readonly lastActiveAtMs: ReadonlyMap<AppId, number>;
};

/**
 * Which apps the count actually moved for, which is not the same as which moments equal now: a
 * first reading starts the clock at now without having observed anything. Returned rather than
 * inferred, so there is one answer to that question and not a second one that rounds differently.
 */
export type Measured = Activity & { readonly moved: ReadonlySet<AppId> };

/**
 * When each app was last reached by something that was not this host.
 *
 * The counters are cumulative and the table they live in is replaced rather than edited, so a
 * count standing below the one before it is the ruleset having been rewritten — which every
 * health flip on every app does — and not an app that has gone quiet. Read as a difference it
 * would be a negative one; read as evidence it is none at all, and the moment already recorded
 * stands.
 *
 * A slot with no counter is an app that is not forwarded: stopped, unhealthy, or never started.
 * Nothing can have reached it, so its moment stands too rather than being reset by its own
 * absence — which is what stops a restart looking like use.
 */
export function activityAfter({
  taken,
  previous,
  nowMs,
}: {
  taken: ReadonlyMap<AppId, AppTraffic>;
  previous: Activity;
  nowMs: number;
}): Measured {
  const traffic = new Map<AppId, AppTraffic>();
  const lastActiveAtMs = new Map<AppId, number>();
  const moved = new Set<AppId>();

  for (const [appId, after] of taken) {
    const before = previous.traffic.get(appId);
    const recorded = previous.lastActiveAtMs.get(appId);
    traffic.set(appId, after);
    if (countMoved({ before, after })) {
      moved.add(appId);
    }
    // No interval behind the first reading of a counter, so it starts the clock rather than
    // answering it: an app whose counter has just appeared has not been idle since the epoch.
    lastActiveAtMs.set(appId, moved.has(appId) ? nowMs : (recorded ?? nowMs));
  }

  for (const [appId, recorded] of previous.lastActiveAtMs) {
    if (!lastActiveAtMs.has(appId)) {
      lastActiveAtMs.set(appId, recorded);
    }
  }

  return { traffic, lastActiveAtMs, moved };
}

function countMoved({
  before,
  after,
}: {
  before: AppTraffic | undefined;
  after: AppTraffic;
}): boolean {
  return before !== undefined && after.bytes > before.bytes;
}

/**
 * What survived the last agent restart. The counts are not kept with it: the first firewall apply
 * after a restart rewrites the table, so every counter is zero by the time this is read and a
 * baseline carried across would be one the kernel has already contradicted.
 */
export function readLastActive(value: unknown): ReadonlyMap<AppId, number> {
  const lastActiveAtMs = new Map<AppId, number>();
  if (!Array.isArray(value)) {
    return lastActiveAtMs;
  }
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { appId, atMs } = entry as Record<string, unknown>;
    if (typeof atMs !== 'number' || !isValidMessage({ schema: AppIdSchema, value: appId })) {
      continue;
    }
    lastActiveAtMs.set(Value.Parse(AppIdSchema, appId), atMs);
  }
  return lastActiveAtMs;
}

/**
 * Read on the measurement tick rather than a tick of its own: it is one local command for the
 * whole host, against one round trip into every guest for the usage beside it.
 *
 * Nothing acts on this yet. It is the record a suspend would decide from, and keeping it from the
 * moment the counters exist is what stops that decision being made against an empty history.
 */
export const recordActivity = Effect.gen(function* () {
  const allocator = yield* SlotAllocator;
  const firewall = yield* HostFirewall;
  const previous = yield* AgentState.snapshot;
  const nowMs = yield* Clock.currentTimeMillis;

  const taken = yield* firewall.traffic.pipe(
    Effect.catchAll((error) =>
      Effect.logDebug('app traffic could not be read', error).pipe(
        Effect.as(new Map<AppId, AppTraffic>()),
      ),
    ),
  );

  const held = new Set((yield* allocator.slots).map((slot) => slot.appId));
  const next = activityAfter({
    taken,
    previous: { traffic: previous.appTraffic, lastActiveAtMs: previous.lastActiveAtMs },
    nowMs,
  });

  // A slot this host no longer holds takes its history with it: the app is somewhere else or
  // nowhere, and either way what it last did here is not something to keep answering about.
  const traffic = new Map([...next.traffic].filter(([appId]) => held.has(appId)));
  const lastActiveAtMs = new Map([...next.lastActiveAtMs].filter(([appId]) => held.has(appId)));
  yield* AgentState.setActivity({ traffic, lastActiveAtMs });

  // One line a tick, at info, because the counts being read at all is the thing worth seeing:
  // `measured: 0` on a host running apps is a counter that never appeared, which reads the same
  // as a quiet host in every other respect. The per-app detail is a level down, where a host
  // packing sixty apps does not write sixty lines a minute into the operator's journal.
  yield* Effect.logInfo('app activity measured').pipe(
    Effect.annotateLogs({
      measured: traffic.size,
      moved: next.moved.size,
      tracked: lastActiveAtMs.size,
    }),
  );
  yield* Effect.logDebug('app activity').pipe(
    Effect.annotateLogs({
      apps: [...lastActiveAtMs].map(([appId, atMs]) => ({ appId, idleMs: nowMs - atMs })),
    }),
  );
});
