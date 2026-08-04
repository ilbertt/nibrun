import type { DesiredVolume, ReportedVolume } from '@repo/protocol';
import { Effect } from 'effect';
import { reportedMessage } from '#lib/failure.ts';
import type { ObservedState, ReconcilePlan } from '#reconcile/plan.ts';
import * as State from '#reconcile/state.ts';
import { toReportedVolume, VolumeManager } from '#volumes/manager.ts';

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
    yield* State.modify((current) => ({
      ...current,
      volumeReports: State.mergeVolumeReports({
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
          State.modify((current) => ({
            ...current,
            volumeReports: State.mergeVolumeReports({
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
