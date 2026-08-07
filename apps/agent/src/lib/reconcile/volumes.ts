import type {
  AppId,
  DesiredVolume,
  HostDesiredState,
  ReportedVolume,
  VolumeId,
} from '@repo/protocol';
import { Effect } from 'effect';
import { reportedMessage } from '#lib/failure.ts';
import type { ObservedState, ReconcilePlan } from '#lib/reconcile/plan.ts';
import { mergeVolumeReports } from '#lib/reconcile/state.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { toReportedVolume } from '#lib/volumes/manager.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { VolumeManager } from '#services/volume-manager.service.ts';

/**
 * Which app owns which volume, so that a device file on disk can be observed as one app's
 * filesystem rather than as an orphan to leave alone.
 *
 * Desired state as well as this agent's own records, because the record is dropped the moment the
 * instance is forgotten — and for an app being deleted that happens first: the control plane stops
 * naming the instance a pass before the volume teardown is unblocked. Keyed on the record alone,
 * the device file stops being observed in the very pass that was going to remove it, the teardown
 * is never planned again, and a tenant's filesystem is kept forever under an app that is gone.
 *
 * The control plane naming a volume is what makes it this app's, so desired state wins.
 */
export function volumeOwners({
  desired,
  records,
}: {
  desired: HostDesiredState;
  records: ReadonlyMap<AppId, InstanceRecord>;
}): ReadonlyMap<VolumeId, AppId> {
  const owners = new Map<VolumeId, AppId>(
    [...records.values()].map((record) => [record.volumeId, record.appId]),
  );
  for (const volume of desired.volumes) {
    owners.set(volume.volumeId, volume.appId);
  }
  return owners;
}

const provision = (desired: DesiredVolume) =>
  Effect.gen(function* () {
    const volumes = yield* VolumeManager;
    return yield* volumes.provision(desired).pipe(
      Effect.catchAll((error) =>
        Effect.logError('volume provisioning failed', error).pipe(
          Effect.annotateLogs({ volumeId: desired.volumeId }),
          Effect.as({
            volumeId: desired.volumeId,
            appId: desired.appId,
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
  desired,
}: {
  plan: ReconcilePlan;
  observed: ObservedState;
  desired: HostDesiredState;
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

    // Anything still named is still being waited on; anything not is a removal the control plane
    // has taken in, and holding it after that would report a volume nobody is asking about.
    yield* AgentState.forgetDeletedVolumes(new Set(desired.volumes.map((one) => one.volumeId)));

    yield* AgentState.modify((current) => ({
      ...current,
      volumeReports: mergeVolumeReports({
        existing: observed.volumes.map(toReportedVolume),
        // After the observation, because a removal this host carried out is not something the
        // next observation can find: the device file it would have been read from is gone.
        updates: [...current.deletedVolumes.values(), ...updates],
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
          // Remembered as well as reported: the report reaches the control plane on the next poll,
          // and a restart in between would otherwise leave nobody able to say the volume is gone.
          AgentState.rememberDeletedVolume(report).pipe(
            Effect.andThen(
              AgentState.modify((current) => ({
                ...current,
                volumeReports: mergeVolumeReports({
                  existing: current.volumeReports,
                  updates: [report],
                }),
              })),
            ),
          ),
        ),
        Effect.catchAll((error) =>
          Effect.logError('volume teardown failed', error).pipe(
            Effect.annotateLogs({ volumeId: action.desired.volumeId }),
          ),
        ),
      );
    }
  });
