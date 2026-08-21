import type { AppId, DesiredInstance, InstanceState } from '@repo/protocol';
import { Clock, Effect } from 'effect';
import { isReadyToRetry, nextAttemptWindow } from '#lib/backoff.ts';
import { nowTimestamp } from '#lib/clock.ts';
import { reportedMessage } from '#lib/failure.ts';
import { probeInstance } from '#lib/health/probe.ts';
import {
  applyProbe,
  describeInstanceFailure,
  evaluateInstanceState,
  type HealthTracker,
  initialTracker,
  nextProbeDelayMs,
} from '#lib/health/state.ts';
import type { ReconcilePlan } from '#lib/reconcile/plan.ts';
import {
  graceInputs,
  type InstanceRecord,
  NO_START_ATTEMPTS,
  newInstanceRecord,
} from '#lib/report/instance-record.ts';
import { ensureArtifactImage } from '#lib/vm/artifacts.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { UNKNOWN_UNIT, type UnitStatus } from '#lib/vm/unit-status.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ReportSignal } from '#services/report-signal.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

const ONE_RESTART = 1;
const NO_RESTART = 0;

/** Under `ignore_fsync` this is the only thing between a stop and the loss of everything since
 * the last periodic flush. */
const flushEverything = Effect.gen(function* () {
  const topology = yield* ZerofsTopology;
  yield* Effect.forEach(
    topology.all,
    (filesystem) =>
      flush(filesystem.admin).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning('zerofs flush failed', error).pipe(
            Effect.annotateLogs({ storagePrefix: filesystem.storagePrefix }),
          ),
        ),
      ),
    { discard: true },
  );
});

export const stopInstance = Effect.fn('stopInstance')(function* ({
  appId,
  reason,
}: {
  appId: AppId;
  reason: string;
}) {
  yield* Effect.annotateCurrentSpan({ appId, reason });
  const vms = yield* VmManager;
  yield* setState({ appId, state: 'stopping', stopRequested: true });
  yield* flushEverything;
  yield* vms.stop(appId).pipe(
    Effect.andThen(Effect.logInfo('instance stopped')),
    Effect.catchAll((error) => Effect.logError('instance stop failed', error)),
    Effect.annotateLogs({ appId, reason }),
  );
  // The budget goes back with it: a stop that was asked for is not a failed start, and an app
  // suspended while it was struggling to boot would otherwise be one nothing could resume.
  yield* AgentState.updateRecord({
    appId,
    change: (record) => ({ ...record, state: 'stopped', startAttempts: NO_START_ATTEMPTS }),
  });
});

function setState({
  appId,
  state,
  stopRequested,
}: {
  appId: AppId;
  state: InstanceState;
  stopRequested?: boolean;
}) {
  return AgentState.updateRecord({
    appId,
    change: (record) => ({
      ...record,
      state,
      ...(stopRequested === undefined ? {} : { stopRequested }),
    }),
  });
}

/**
 * A boot that follows a stop somebody asked for is the instance coming back, not the tenant
 * having gone down: counting it would have an app that was suspended over the weekend read as one
 * that crashed.
 */
function restarted(existing: InstanceRecord | undefined): boolean {
  return existing !== undefined && !existing.stopRequested;
}

function isStartable({
  existing,
  nowMs,
  desired,
}: {
  existing: InstanceRecord | undefined;
  nowMs: number;
  desired: DesiredInstance;
}): boolean {
  if (!existing) {
    return true;
  }
  const policy = desired.config.restartPolicy;
  return (
    existing.startAttempts.attempts <= policy.maxRestarts &&
    isReadyToRetry({ window: existing.startAttempts, nowMs, policy })
  );
}

/**
 * One entry per digest: two apps deploying the same bytes share the image, and fetching it
 * twice at once would have them race for the same staging directory.
 */
function artifactsToStart(plan: ReconcilePlan) {
  return new Map(
    plan.instances.flatMap((action) =>
      action.action === 'start' || action.action === 'replace'
        ? [[action.desired.artifact.digest, action.desired.artifact] as const]
        : [],
    ),
  ).values();
}

/**
 * Downloading the artifact and building its image is the longest step of a deploy, and it does
 * not need the host to have stopped anything — so it runs while the outgoing microVM is still
 * serving rather than after it is gone.
 *
 * Best-effort: `startInstance` asks for the same image and is the one that reports a fetch that
 * could not be made, so a failure here is only a head start that was not taken.
 */
export const prefetchArtifacts = Effect.fn('prefetchArtifacts')((plan: ReconcilePlan) =>
  Effect.forEach(
    artifactsToStart(plan),
    (artifact) =>
      ensureArtifactImage(artifact).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning('artifact prefetch failed', error).pipe(
            Effect.annotateLogs({ digest: artifact.digest }),
          ),
        ),
      ),
    { discard: true, concurrency: 'unbounded' },
  ),
);

export const startInstance = Effect.fn('startInstance')(function* (desired: DesiredInstance) {
  yield* Effect.annotateCurrentSpan({ appId: desired.appId });
  const allocator = yield* SlotAllocator;
  const vms = yield* VmManager;
  const nowMs = yield* Clock.currentTimeMillis;
  const existing = (yield* AgentState.snapshot).records.get(desired.appId);
  if (!isStartable({ existing, nowMs, desired })) {
    return;
  }

  const slot = yield* allocator.allocate(desired.appId);
  const attempted: InstanceRecord = {
    ...(existing ??
      newInstanceRecord({
        appId: desired.appId,
        deploymentId: desired.deploymentId,
        volumeId: desired.volumeId,
        hostnames: desired.hostnames,
        hostPort: slot.hostPort,
        guestPort: desired.config.guestPort,
        guestIpv4: slot.guestIpv4,
        artifactDigest: desired.artifact.digest,
        state: 'pending',
        health: initialTracker(),
        healthCheck: desired.config.healthCheck,
        resources: desired.config.resources,
        desiredRunning: true,
      })),
    startAttempts: nextAttemptWindow({
      window: existing?.startAttempts ?? NO_START_ATTEMPTS,
      nowMs,
      resetAfterMs: desired.config.restartPolicy.resetAfterMs,
    }),
  };
  yield* AgentState.putRecord(attempted);

  yield* Effect.matchEffect(vms.boot({ desired, slot, dataDevicePath: slot.nbdDevicePath }), {
    onSuccess: () =>
      Effect.gen(function* () {
        yield* AgentState.putRecord({
          ...attempted,
          startedAt: yield* nowTimestamp,
          state: 'starting',
          stopRequested: false,
          health: initialTracker(),
          restartCount: attempted.restartCount + (restarted(existing) ? ONE_RESTART : NO_RESTART),
          message: undefined,
        });
        yield* AgentState.modify((current) => {
          const nextProbeAtMs = new Map(current.nextProbeAtMs);
          nextProbeAtMs.delete(desired.appId);
          return { ...current, nextProbeAtMs };
        });
        yield* Effect.logInfo('instance started').pipe(
          Effect.annotateLogs({
            appId: desired.appId,
            hostPort: attempted.hostPort,
            guestIpv4: attempted.guestIpv4,
          }),
        );
      }),
    onFailure: (error) =>
      Effect.gen(function* () {
        yield* AgentState.putRecord({
          ...attempted,
          state: 'failed',
          message: reportedMessage(error),
        });
        yield* Effect.logError('instance start failed', error).pipe(
          Effect.annotateLogs({
            appId: desired.appId,
            attempt: attempted.startAttempts.attempts,
          }),
        );
      }),
  });
});

/** Only a failure has anything to say: every other state is its own account of itself. */
function verdict({
  state,
  status,
  health,
  record,
}: {
  state: InstanceState;
  status: UnitStatus;
  health: HealthTracker;
  record: InstanceRecord;
}): string | undefined {
  return state === 'failed'
    ? describeInstanceFailure({
        unit: status,
        tracker: health,
        healthCheck: record.healthCheck,
        guestPort: record.guestPort,
      })
    : undefined;
}

function probed({ record, nowMs }: { record: InstanceRecord; nowMs: number }) {
  return Effect.gen(function* () {
    const healthy = yield* probeInstance({
      guestIpv4: record.guestIpv4,
      guestPort: record.guestPort,
      healthCheck: record.healthCheck,
    });
    const delayMs = nextProbeDelayMs({
      tracker: record.health,
      ...graceInputs({ record, nowMs }),
    });
    yield* AgentState.modify((current) => ({
      ...current,
      nextProbeAtMs: new Map(current.nextProbeAtMs).set(record.appId, nowMs + delayMs),
    }));
    return applyProbe({
      tracker: record.health,
      healthy,
      at: yield* nowTimestamp,
      healthyThreshold: record.healthCheck.healthyThreshold,
    });
  });
}

/** Probes the tenants that are due, then settles each state from systemd and the probe together. */
export const refreshStates = Effect.gen(function* () {
  const current = yield* AgentState.snapshot;
  const statuses = yield* Systemd.statuses([...current.records.keys()]);
  const nowMs = yield* Clock.currentTimeMillis;

  yield* Effect.forEach(
    [...current.records.values()],
    (record) =>
      Effect.gen(function* () {
        const status = statuses.get(record.appId) ?? UNKNOWN_UNIT;
        const due = nowMs >= (current.nextProbeAtMs.get(record.appId) ?? 0);
        const health = status.active && due ? yield* probed({ record, nowMs }) : record.health;

        const state = evaluateInstanceState({
          unit: status,
          tracker: health,
          desiredRunning: record.desiredRunning,
          stopRequested: record.stopRequested,
          ...graceInputs({ record, nowMs }),
        });

        const changed = state !== record.state;
        yield* AgentState.putRecord({
          ...record,
          health,
          state,
          ...(changed && status.exitCode !== undefined && !status.active
            ? { lastExitCode: status.exitCode }
            : {}),
          // Cleared as readily as it is written: a message outliving the state it explains is
          // read as an account of the state that replaced it.
          ...(changed ? { message: verdict({ state, status, health, record }) } : {}),
        });
        if (changed) {
          yield* Effect.logInfo('instance state changed').pipe(
            Effect.annotateLogs({
              appId: record.appId,
              from: record.state,
              to: state,
            }),
          );
          yield* ReportSignal.raise;
        }
      }),
    { discard: true },
  );
});
