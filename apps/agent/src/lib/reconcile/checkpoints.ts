import type { HostDesiredState, ReportedCheckpoint } from '@repo/protocol';
import { Effect } from 'effect';
import { nowTimestamp } from '#lib/clock.ts';
import { reportedMessage } from '#lib/failure.ts';
import type { CheckpointPlan, ReconcilePlan } from '#lib/reconcile/plan.ts';
import { AppVolumeOperationUnavailable, usesAppVolumeStorage } from '#lib/volumes/placement.ts';
import { createCheckpoint, deleteCheckpoint, listCheckpoints } from '#lib/volumes/zerofs.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

type Applicable = Extract<CheckpointPlan, { action: 'create' | 'delete' }>;

/** `CreateCheckpoint` takes the flush barrier itself, so an extra flush here would be a redundant
 * round trip against a guarantee the RPC already makes. */
const applyOne = Effect.fn('applyCheckpoint')(function* (action: Applicable) {
  const topology = yield* ZerofsTopology;
  const { checkpointId, volumeId } = action.desired;
  yield* Effect.annotateCurrentSpan({ checkpointId, volumeId });
  const target = topology.place().admin;

  return yield* Effect.gen(function* () {
    const existing = new Set(yield* listCheckpoints(target));
    if (action.action === 'create') {
      if (!existing.has(checkpointId)) {
        yield* createCheckpoint({ target, checkpointId });
      }
      return {
        checkpointId,
        volumeId,
        state: 'ready',
        reference: checkpointId,
        readyAt: yield* nowTimestamp,
      } satisfies ReportedCheckpoint;
    }
    if (existing.has(checkpointId)) {
      yield* deleteCheckpoint({ target, checkpointId });
    }
    return { checkpointId, volumeId, state: 'pending' } satisfies ReportedCheckpoint;
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        checkpointId,
        volumeId,
        state: 'failed',
        message: reportedMessage(error),
      } satisfies ReportedCheckpoint),
    ),
  );
});

/** Listing costs an RPC round trip, and almost every reconcile has no checkpoint to converge. */
export const applyCheckpoints = ({
  plan,
  desired,
}: {
  plan: ReconcilePlan;
  desired: HostDesiredState;
}) =>
  Effect.gen(function* () {
    const applicable =
      desired.checkpoints.length === 0
        ? []
        : plan.checkpoints.filter((action): action is Applicable => action.action !== 'none');
    const checkpointReports = yield* Effect.forEach(applicable, (action) =>
      Effect.gen(function* () {
        const volume = desired.volumes.find(
          (volume) => volume.volumeId === action.desired.volumeId,
        );
        if (volume !== undefined && (yield* usesAppVolumeStorage(volume))) {
          return {
            checkpointId: action.desired.checkpointId,
            volumeId: action.desired.volumeId,
            state: 'failed',
            message: new AppVolumeOperationUnavailable().message,
          } satisfies ReportedCheckpoint;
        }
        return yield* applyOne(action);
      }),
    );
    yield* AgentState.modify((current) => ({ ...current, checkpointReports }));
  });
