import type { HostDesiredState } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { readExportReports } from '#lib/exports/manager.ts';
import { readJsonFile, writeJsonFile } from '#lib/json-store.ts';
import { applyCheckpoints } from '#lib/reconcile/checkpoints.ts';
import { applyExports } from '#lib/reconcile/exports.ts';
import {
  prefetchArtifacts,
  refreshStates,
  startInstance,
  stopInstance,
} from '#lib/reconcile/instances.ts';
import { applyNetwork, applyRoutes } from '#lib/reconcile/network.ts';
import { hasDeferredWork, type ObservedState, planReconcile } from '#lib/reconcile/plan.ts';
import { applyTeardowns, applyVolumes } from '#lib/reconcile/volumes.ts';
import { readInstanceRecords } from '#lib/report/instance-record.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { UNKNOWN_UNIT } from '#lib/vm/unit-status.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ReportSignal } from '#services/report-signal.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { VolumeManager } from '#services/volume-manager.service.ts';

/**
 * Pull, converge, report. Nothing here is driven by a command: desired state describes a world,
 * this compares it with what the host is observed to be doing, and the difference is the work.
 */
export class Reconciler extends Effect.Service<Reconciler>()('Reconciler', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const allocator = yield* SlotAllocator;
    const volumes = yield* VolumeManager;
    const vms = yield* VmManager;

    const load = Effect.gen(function* () {
      const instances = readInstanceRecords(
        Option.getOrUndefined(yield* readJsonFile(config.instancesFile)),
      );
      const exports = readExportReports(
        Option.getOrUndefined(yield* readJsonFile(config.exportsFile)),
      );
      yield* AgentState.modify((current) => ({
        ...current,
        records: new Map(instances.map((record) => [record.appId, record])),
        exportReports: new Map(exports.map((report) => [report.exportId, report])),
      }));
      yield* Effect.logInfo('agent state loaded').pipe(
        Effect.annotateLogs({
          instances: instances.length,
          slots: (yield* allocator.slots).length,
          exports: exports.length,
        }),
      );
    }).pipe(Effect.withSpan('Reconciler.load'));

    /**
     * The union of what systemd knows and what this agent has notes on: a unit with no note is an
     * orphan to stop, and a note with no unit is an instance that is gone.
     */
    const observe = Effect.gen(function* () {
      const current = yield* AgentState.snapshot;
      const unitIds = yield* Systemd.listAppIds.pipe(Effect.orElseSucceed(() => []));
      const ids = [...new Set([...unitIds, ...current.records.keys()])];
      const statuses = yield* Systemd.statuses(ids).pipe(
        Effect.orElseSucceed(() => new Map<(typeof ids)[number], typeof UNKNOWN_UNIT>()),
      );

      return {
        instances: ids.map((appId) => {
          const status = statuses.get(appId) ?? UNKNOWN_UNIT;
          const record = current.records.get(appId);
          return {
            appId,
            ...(record
              ? {
                  appId: record.appId,
                  volumeId: record.volumeId,
                  deploymentId: record.deploymentId,
                }
              : {}),
            present: status.loaded || record !== undefined,
            running: status.active,
            // `startedThisBoot` keeps a reboot out of this: the record survives on disk, so
            // without it every instance would look exited after a reboot and be left alone.
            exited:
              !status.active &&
              status.startedThisBoot &&
              record?.startedAt !== undefined &&
              !record.stopRequested,
          };
        }),
        volumes: yield* volumes
          .observe(yield* AgentState.appIdByVolume)
          .pipe(Effect.orElseSucceed(() => [])),
        checkpoints: [],
        exports: [...current.exportReports.values()].map((report) => ({
          exportId: report.exportId,
          written: report.state === 'ready',
        })),
      } satisfies ObservedState;
    }).pipe(Effect.withSpan('Reconciler.observe'));

    const persist = Effect.gen(function* () {
      const current = yield* AgentState.snapshot;
      yield* allocator.persist;
      yield* writeJsonFile({
        path: config.instancesFile,
        value: [...current.records.values()],
      });
      yield* writeJsonFile({
        path: config.exportsFile,
        value: [...current.exportReports.values()],
      });
    });

    /**
     * Hostnames, the health check and whether the app should be up all change without the
     * artifact changing, so they are folded in before anything reads the record.
     */
    const syncDesired = (desired: HostDesiredState) =>
      Effect.forEach(
        desired.instances,
        (wanted) =>
          AgentState.updateRecord({
            appId: wanted.appId,
            change: (record) => ({
              ...record,
              hostnames: wanted.hostnames,
              healthCheck: wanted.config.healthCheck,
              resources: wanted.config.resources,
              desiredRunning: wanted.desiredState === 'running',
              guestPort: wanted.config.guestPort,
            }),
          }),
        { discard: true },
      );

    const applyStops = (plan: ReturnType<typeof planReconcile>) =>
      Effect.forEach(
        plan.instances,
        (action) => {
          if (action.action === 'stop') {
            return stopInstance({ appId: action.appId, reason: action.reason });
          }
          if (action.action === 'replace') {
            return stopInstance({
              appId: action.desired.appId,
              reason: 'superseded',
            }).pipe(
              Effect.andThen(vms.discard(action.desired.appId)),
              Effect.andThen(AgentState.dropRecord(action.desired.appId)),
            );
          }
          if (action.action === 'forget') {
            return vms
              .discard(action.appId)
              .pipe(Effect.andThen(AgentState.dropRecord(action.appId)));
          }
          return Effect.void;
        },
        { discard: true },
      );

    /**
     * A tenant only ever boots onto a host whose isolation ruleset is in the kernel: the guest is
     * an arbitrary binary one routing decision away from the control plane and its neighbours.
     */
    const applyStarts = (plan: ReturnType<typeof planReconcile>) =>
      Effect.gen(function* () {
        const starts = plan.instances.filter(
          (action) => action.action === 'start' || action.action === 'replace',
        );
        if (starts.length === 0) {
          return;
        }
        if (!(yield* AgentState.snapshot).isolated) {
          return yield* Effect.logError(
            'instance starts refused: isolation ruleset not applied',
          ).pipe(Effect.annotateLogs({ refused: starts.length }));
        }
        yield* Effect.forEach(
          starts,
          (action) =>
            action.action === 'start' || action.action === 'replace'
              ? startInstance(action.desired)
              : Effect.void,
          { discard: true },
        );
      });

    const reconcile = Effect.fn('Reconciler.reconcile')(function* (desired: HostDesiredState) {
      const observed = yield* observe;
      const plan = planReconcile({ desired, observed });
      yield* AgentState.modify((current) => ({
        ...current,
        deferredWork: hasDeferredWork(plan),
      }));
      yield* syncDesired(desired);

      yield* Effect.all(
        [prefetchArtifacts(plan), applyStops(plan).pipe(Effect.withSpan('reconcile.stops'))],
        { concurrency: 'unbounded', discard: true },
      );
      yield* applyVolumes({ plan, observed }).pipe(Effect.withSpan('reconcile.volumes'));
      // Before anything boots: nothing persists the ruleset across a reboot, so a host that
      // started its VMs first would serve tenants through a kernel with no `nibrun` table.
      yield* applyNetwork.pipe(Effect.withSpan('reconcile.network'));
      yield* applyStarts(plan).pipe(Effect.withSpan('reconcile.starts'));
      yield* applyCheckpoints({ plan, desired }).pipe(Effect.withSpan('reconcile.checkpoints'));
      // After starts, so an export never competes with a boot for the device it reads, and
      // before teardowns, so a volume marked absent this generation is still there to read.
      yield* applyExports({ plan }).pipe(Effect.withSpan('reconcile.exports'));
      yield* applyTeardowns(plan).pipe(Effect.withSpan('reconcile.teardowns'));
      // Again, because the instances started above are the ones whose forwards this renders.
      yield* applyNetwork.pipe(Effect.withSpan('reconcile.network'));
      yield* applyRoutes.pipe(Effect.withSpan('reconcile.routes'));
      yield* persist.pipe(Effect.withSpan('reconcile.persist'));

      yield* AgentState.modify((current) => ({ ...current, converged: true }));
      // Everything a reconcile touches is something the control plane is waiting to hear about:
      // the instance it just asked for, a volume it may now delete, a bundle it can hand over.
      yield* ReportSignal.raise;
    });

    return {
      load,
      observe,
      reconcile,
      // An instance becomes routable here rather than in reconcile: the probe is what tells a
      // booted VM from one whose tenant has answered.
      refresh: refreshStates.pipe(
        Effect.andThen(applyRoutes),
        Effect.andThen(persist),
        Effect.withSpan('Reconciler.refresh'),
      ),
    };
  }),
  dependencies: [
    AgentConfig.Default,
    SlotAllocator.Default,
    VolumeManager.Default,
    VmManager.Default,
  ],
}) {}
