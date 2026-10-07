import { Effect } from 'effect';
import {
  applyActivators,
  applyNetwork,
  applyNetworkStrict,
  applyRoutes,
  applyRoutesStrict,
} from '#lib/reconcile/network.ts';
import type { ReconcilePlan } from '#lib/reconcile/plan.ts';
import { AgentState } from '#services/agent-state.service.ts';

export function duringReplacements<A, E, R>({
  plan,
  effect,
}: {
  plan: ReconcilePlan;
  effect: Effect.Effect<A, E, R>;
}) {
  const replacing = new Set(
    plan.instances.flatMap((action) => (action.action === 'replace' ? [action.desired.appId] : [])),
  );
  if (replacing.size === 0) {
    return effect;
  }
  return Effect.acquireUseRelease(
    AgentState.modify((current) => ({
      ...current,
      replacing: new Map([...current.records].filter(([appId]) => replacing.has(appId))),
    })),
    () =>
      applyActivators.pipe(
        Effect.andThen(applyRoutesStrict),
        Effect.andThen(applyNetworkStrict),
        Effect.andThen(effect),
      ),
    () =>
      AgentState.modify((current) => ({ ...current, replacing: new Map() })).pipe(
        Effect.andThen(applyNetwork),
        Effect.andThen(applyRoutes),
      ),
  ).pipe(
    Effect.onError(() => AgentState.modify((current) => ({ ...current, deferredWork: true }))),
  );
}
