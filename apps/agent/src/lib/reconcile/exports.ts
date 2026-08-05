import type { ExportId, HostDesiredState, ReportedExport } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { reportedMessage } from '#lib/failure.ts';
import type { ExportPlan, ReconcilePlan } from '#lib/reconcile/plan.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ExportManager } from '#services/export-manager.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

const setReport = (report: ReportedExport) =>
  AgentState.modify((current) => ({
    ...current,
    exportReports: new Map(current.exportReports).set(report.exportId, report),
  }));

const forget = (exportId: ExportId) =>
  AgentState.modify((current) => {
    const exportReports = new Map(current.exportReports);
    exportReports.delete(exportId);
    return { ...current, exportReports };
  });

/**
 * The device is the only thing an export needs this host to still have: the volume is provisioned
 * from its own desired state, so it stays attached whether or not anything is running against it.
 */
const write = ({ action }: { action: Extract<ExportPlan, { action: 'write' }> }) =>
  Effect.gen(function* () {
    const exports = yield* ExportManager;
    const allocator = yield* SlotAllocator;
    const { exportId, appId, artifact } = action.desired;
    const slot = yield* allocator.lookup(appId);

    if (Option.isNone(slot)) {
      const reason = 'no device attached for this app';
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

export const applyExports = ({ plan }: { plan: ReconcilePlan }) =>
  Effect.forEach(
    plan.exports,
    (action) => {
      if (action.action === 'none') {
        return Effect.void;
      }
      return action.action === 'forget'
        ? forget(action.exportId)
        : Effect.flatMap(write({ action }), setReport);
    },
    { discard: true },
  );
