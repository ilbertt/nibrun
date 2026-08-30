import type { AppId } from '@repo/protocol';
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
}): Activity {
  const traffic = new Map<AppId, AppTraffic>();
  const lastActiveAtMs = new Map<AppId, number>();

  for (const [appId, after] of taken) {
    const before = previous.traffic.get(appId);
    const recorded = previous.lastActiveAtMs.get(appId);
    traffic.set(appId, after);
    // No interval behind the first reading of a counter, so it starts the clock rather than
    // answering it: an app whose counter has just appeared has not been idle since the epoch.
    lastActiveAtMs.set(appId, moved({ before, after }) ? nowMs : (recorded ?? nowMs));
  }

  for (const [appId, recorded] of previous.lastActiveAtMs) {
    if (!lastActiveAtMs.has(appId)) {
      lastActiveAtMs.set(appId, recorded);
    }
  }

  return { traffic, lastActiveAtMs };
}

function moved({ before, after }: { before: AppTraffic | undefined; after: AppTraffic }): boolean {
  return before !== undefined && after.bytes > before.bytes;
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
  yield* AgentState.setActivity({
    traffic: new Map([...next.traffic].filter(([appId]) => held.has(appId))),
    lastActiveAtMs: new Map([...next.lastActiveAtMs].filter(([appId]) => held.has(appId))),
  });
});
