import type { ExportId, ReportedExport } from '@repo/protocol';
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
 * The volume is the only thing an export needs this host to still have, and a slot is how the
 * host says it has one: slots are handed out by provisioning and given up only by an explicit
 * teardown, so an app with none is one whose filesystem was never placed here. The device behind
 * the slot is not what gets read — the bundle comes off a checkpoint — but a checkpoint of this
 * host's storage holds nothing for an app this host never provisioned.
 */
const write = ({ action }: { action: Extract<ExportPlan, { action: 'write' }> }) =>
  Effect.gen(function* () {
    const exports = yield* ExportManager;
    const allocator = yield* SlotAllocator;
    const { exportId, appId, artifact } = action.desired;
    const slot = yield* allocator.lookup(appId);

    if (Option.isNone(slot)) {
      const reason = 'this host does not serve this app filesystem';
      yield* Effect.logError('export not writable here').pipe(
        Effect.annotateLogs({ exportId, appId, reason }),
      );
      return { exportId, state: 'failed', message: reason } satisfies ReportedExport;
    }

    return yield* exports.write({ desired: action.desired, artifact }).pipe(
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

/**
 * The reap goes first, and on every pass rather than only when there is an export to write: a
 * checkpoint left behind is one nothing asks for any more, so a pass with no export work is
 * exactly the pass that finds one. Before the writes, so an export never starts against a device
 * or a server a dead predecessor left attached.
 */
export const applyExports = ({ plan }: { plan: ReconcilePlan }) =>
  Effect.gen(function* () {
    const exports = yield* ExportManager;
    yield* exports.reap;
    yield* Effect.forEach(
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
  });
