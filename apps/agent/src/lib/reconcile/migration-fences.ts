import type { AppId, HostDesiredState, VolumeId } from '@repo/protocol';
import { Effect } from 'effect';
import { type ObservedState, planReconcile, type ReconcilePlan } from '#lib/reconcile/plan.ts';
import { volumeOwners } from '#lib/reconcile/volumes.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { VolumeMigrationFences } from '#services/volume-migration-fences.service.ts';

export function withoutFencedApps({
  plan,
  blocked,
  owners,
}: {
  plan: ReconcilePlan;
  blocked: ReadonlySet<AppId>;
  owners: ReadonlyMap<VolumeId, AppId>;
}): ReconcilePlan {
  if (blocked.size === 0) {
    return plan;
  }
  return {
    instances: plan.instances.filter(
      (action) => !blocked.has('desired' in action ? action.desired.appId : action.appId),
    ),
    volumes: plan.volumes.filter(
      (action) => !('desired' in action) || !blocked.has(action.desired.appId),
    ),
    checkpoints: plan.checkpoints.filter((action) => {
      if (!('desired' in action)) {
        return true;
      }
      const owner = owners.get(action.desired.volumeId);
      return owner !== undefined && !blocked.has(owner);
    }),
    exports: plan.exports.filter(
      (action) => !('desired' in action) || !blocked.has(action.desired.appId),
    ),
  };
}

export function duringUnfencedReconciliation<A, E, R, ObserveError, ObserveContext>({
  desired,
  observe,
  use,
}: {
  desired: HostDesiredState;
  observe: (
    unitIds: readonly AppId[],
  ) => Effect.Effect<ObservedState, ObserveError, ObserveContext>;
  use: (input: {
    plan: ReconcilePlan;
    blocked: ReadonlySet<AppId>;
    observed: ObservedState;
  }) => Effect.Effect<A, E, R>;
}) {
  return Effect.gen(function* () {
    const records = (yield* AgentState.snapshot).records;
    const unitIds = yield* Systemd.listAppIds.pipe(Effect.orElseSucceed(() => []));
    const appIds = new Set([
      ...records.keys(),
      ...unitIds,
      ...desired.volumes.map((volume) => volume.appId),
      ...desired.instances.map((instance) => instance.appId),
      ...desired.exports.map((entry) => entry.appId),
    ]);
    const fences = yield* VolumeMigrationFences;
    return yield* fences.access({
      appIds,
      use: (blocked) =>
        Effect.gen(function* () {
          const observed = yield* observe(unitIds);
          const owners = volumeOwners({ desired, records: (yield* AgentState.snapshot).records });
          return yield* use({
            plan: withoutFencedApps({
              plan: planReconcile({ desired, observed }),
              blocked,
              owners,
            }),
            blocked,
            observed,
          });
        }),
    });
  });
}
