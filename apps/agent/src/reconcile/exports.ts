import type { ExportId, HostDesiredState, ReportedExport } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { ExportManager } from '#exports/manager.ts';
import { reportedMessage } from '#lib/failure.ts';
import { SlotAllocator } from '#network/allocator.ts';
import type { ExportPlan, ReconcilePlan } from '#reconcile/plan.ts';
import * as State from '#reconcile/state.ts';

const setReport = (report: ReportedExport) =>
  State.modify((current) => ({
    ...current,
    exportReports: new Map(current.exportReports).set(report.exportId, report),
  }));

const forget = (exportId: ExportId) =>
  State.modify((current) => {
    const exportReports = new Map(current.exportReports);
    exportReports.delete(exportId);
    return { ...current, exportReports };
  });

/**
 * The artifact is joined from the instance desired state rather than carried on the export, so a
 * bundle can only pair a filesystem with the binary this host was told to run against it.
 */
const write = ({
  action,
  desired,
}: {
  action: Extract<ExportPlan, { action: 'write' }>;
  desired: HostDesiredState;
}) =>
  Effect.gen(function* () {
    const exports = yield* ExportManager;
    const allocator = yield* SlotAllocator;
    const { exportId, appId } = action.desired;
    const artifact = desired.instances.find((instance) => instance.appId === appId)?.artifact;
    const slot = yield* allocator.lookup(appId);

    if (!artifact || Option.isNone(slot)) {
      const reason = artifact
        ? 'no device attached for this app'
        : 'no instance to take a binary from';
      yield* Effect.logError('export not writable here').pipe(
        Effect.annotateLogs({ exportId, appId, reason }),
      );
      return { exportId, state: 'failed', message: reason } satisfies ReportedExport;
    }

    return yield* exports
      .write({ desired: action.desired, artifact, devicePath: slot.value.nbdDevicePath })
      .pipe(
        Effect.catchAll((error) =>
          Effect.logError('export failed', error).pipe(
            Effect.annotateLogs({ exportId, appId }),
            Effect.as({
              exportId,
              state: 'failed',
              message: reportedMessage(error),
            } satisfies ReportedExport),
          ),
        ),
      );
  });

export const applyExports = ({
  plan,
  desired,
}: {
  plan: ReconcilePlan;
  desired: HostDesiredState;
}) =>
  Effect.forEach(
    plan.exports,
    (action) => {
      if (action.action === 'none') {
        return Effect.void;
      }
      return action.action === 'forget'
        ? forget(action.exportId)
        : Effect.flatMap(write({ action, desired }), setReport);
    },
    { discard: true },
  );
