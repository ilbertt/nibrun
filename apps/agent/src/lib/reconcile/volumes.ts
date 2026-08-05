import type { DesiredVolume, ReportedVolume } from '@repo/protocol';
import { Effect } from 'effect';
import { reportedMessage } from '#lib/failure.ts';
import type { ObservedState, ReconcilePlan } from '#lib/reconcile/plan.ts';
import { mergeVolumeReports } from '#lib/reconcile/state.ts';
import { toReportedVolume } from '#lib/volumes/manager.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { VolumeManager } from '#services/volume-manager.service.ts';

const provision = (desired: DesiredVolume) =>
  Effect.gen(function* () {
    const volumes = yield* VolumeManager;
    return yield* volumes.provision(desired).pipe(
      Effect.catchAll((error) =>
        Effect.logError('volume provisioning failed', error).pipe(
          Effect.annotateLogs({ volumeId: desired.volumeId }),
          Effect.as({
            volumeId: desired.volumeId,
            state: 'failed',
            sizeBytes: desired.sizeBytes,
            message: reportedMessage(error),
          } satisfies ReportedVolume),
        ),
      ),
    );
  });

export const applyVolumes = ({
  plan,
  observed,
}: {
  plan: ReconcilePlan;
  observed: ObservedState;
}) =>
  Effect.gen(function* () {
    const updates: ReportedVolume[] = [];
    for (const action of plan.volumes) {
      if (action.action === 'provision') {
        updates.push(yield* provision(action.desired));
      }
      if (action.action === 'blocked') {
        yield* Effect.logWarning('volume removal deferred: still attached').pipe(
          Effect.annotateLogs({
            volumeId: action.desired.volumeId,
            blockedBy: action.blockedBy,
          }),
        );
      }
    }
    yield* AgentState.modify((current) => ({
      ...current,
      volumeReports: mergeVolumeReports({
        existing: observed.volumes.map(toReportedVolume),
        updates,
      }),
    }));
  });

export const applyTeardowns = (plan: ReconcilePlan) =>
  Effect.gen(function* () {
    const volumes = yield* VolumeManager;
    for (const action of plan.volumes) {
      if (action.action !== 'teardown') {
        continue;
      }
      yield* volumes.teardown(action.desired).pipe(
        Effect.flatMap((report) =>
          AgentState.modify((current) => ({
            ...current,
            volumeReports: mergeVolumeReports({
              existing: current.volumeReports,
              updates: [report],
            }),
          })),
        ),
        Effect.catchAll((error) =>
          Effect.logError('volume teardown failed', error).pipe(
            Effect.annotateLogs({ volumeId: action.desired.volumeId }),
          ),
        ),
      );
    }
  });
