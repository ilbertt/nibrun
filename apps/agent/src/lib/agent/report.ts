import type { AppId } from '@repo/protocol';
import { Duration, Effect, Option } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import { nowTimestamp } from '#lib/clock.ts';
import { buildReportedState } from '#lib/report/build-report.ts';
import {
  allocatableCapacity,
  committedResources,
  readAvailableCacheBytes,
  readHostCapacity,
} from '#lib/report/capacity.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import type { PublicAddress } from '#lib/vm/instance-env.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { ReportSignal } from '#services/report-signal.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

/**
 * Resolved here rather than kept on the record: the port belongs to the slot the app holds and
 * the address to the relay this host was configured with, so reading both at report time is what
 * makes giving a port up show up in the next report rather than at the next boot.
 */
const publicAddresses = (records: readonly InstanceRecord[]) =>
  Effect.gen(function* () {
    const config = yield* AgentConfig;
    const allocator = yield* SlotAllocator;
    const reached = new Map<AppId, PublicAddress>();
    for (const record of records.filter((one) => one.hasExtraPublicPort)) {
      const slot = yield* allocator.lookup(record.appId);
      if (Option.isSome(slot)) {
        reached.set(record.appId, {
          ipv4: config.portRelayPublicIpv4,
          port: slot.value.extraPublicPort,
        });
      }
    }
    return reached;
  });

/**
 * The floor a raise cannot get under. Without it an instance flapping between two states would
 * turn every transition into a request, which is the thing `reportIntervalMs` exists to bound.
 */
const MIN_REPORT_GAP: Duration.DurationInput = '250 millis';

const report = Effect.gen(function* () {
  const config = yield* AgentConfig;
  const control = yield* ControlPlane;
  const sessions = yield* AgentSessionHolder;

  const session = yield* sessions.current;
  const current = yield* AgentState.snapshot;
  const records = [...current.records.values()];
  const capacity = yield* readHostCapacity({
    cacheDir: config.stateDir,
    zerofsConfigFile: config.zerofsConfigFile,
  });
  const reachedAt = yield* publicAddresses(records);

  yield* control.sendReportedState({
    sessionToken: session.sessionToken,
    report: buildReportedState({
      hostId: session.hostId,
      reportedAt: yield* nowTimestamp,
      state: current.converged ? 'ready' : 'registering',
      capacity,
      allocatable: allocatableCapacity({
        capacity,
        committed: committedResources(records),
        availableCacheBytes: yield* readAvailableCacheBytes(config.stateDir),
      }),
      versions: sessions.versions,
      records,
      reachedAt,
      volumes: current.volumeReports,
      volumeUsage: current.volumeUsage,
      computeUsage: current.computeUsage,
      checkpoints: current.checkpointReports,
      exports: [...current.exportReports.values()],
    }),
  });
});

/**
 * `reportIntervalMs` is the longest a host stays quiet, not the rate it reports at: a tenant
 * that has just answered its first probe is news the control plane is holding a deploy open
 * waiting for, and telling it on the next tick instead adds that tick to every deploy.
 */
const untilNextReport = Effect.gen(function* () {
  const sessions = yield* AgentSessionHolder;
  const poll = yield* sessions.pollSettings;
  yield* Effect.race(
    Effect.sleep(Duration.millis(poll.reportIntervalMs)),
    Effect.andThen(Effect.sleep(MIN_REPORT_GAP), ReportSignal.awaited),
  );
});

export const reportLoop = Effect.gen(function* () {
  const sessions = yield* AgentSessionHolder;
  yield* supervised({
    once: Effect.andThen(report, untilNextReport).pipe(
      Effect.tapErrorTag('ControlPlaneError', sessions.onExpired),
    ),
    onFailure: (cause) => Effect.logWarning('report failed', cause),
    schedule: CONTROL_PLANE_BACKOFF,
  });
});
