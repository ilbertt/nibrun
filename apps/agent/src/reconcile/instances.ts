import type { DesiredInstance, InstanceId, InstanceState } from '@repo/protocol';
import { Clock, Effect } from 'effect';
import { probeInstance } from '#health/probe.ts';
import { applyProbe, evaluateInstanceState, initialTracker } from '#health/state.ts';
import { isReadyToRetry, nextAttemptWindow } from '#lib/backoff.ts';
import { nowTimestamp } from '#lib/clock.ts';
import { reportedMessage } from '#lib/failure.ts';
import * as State from '#reconcile/state.ts';
import { type InstanceRecord, newInstanceRecord } from '#report/instance-record.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import * as Systemd from '#vm/systemd.ts';
import { UNKNOWN_UNIT } from '#vm/unit-status.ts';
import { flush } from '#volumes/zerofs.ts';

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
  instanceId,
  reason,
}: {
  instanceId: InstanceId;
  reason: string;
}) {
  yield* Effect.annotateCurrentSpan({ instanceId, reason });
  const vms = yield* VmManager;
  yield* setState({ instanceId, state: 'stopping', stopRequested: true });
  yield* flushEverything;
  yield* vms.stop(instanceId).pipe(
    Effect.andThen(Effect.logInfo('instance stopped')),
    Effect.catchAll((error) => Effect.logError('instance stop failed', error)),
    Effect.annotateLogs({ instanceId, reason }),
  );
  yield* setState({ instanceId, state: 'stopped' });
});

const setState = ({
  instanceId,
  state,
  stopRequested,
}: {
  instanceId: InstanceId;
  state: InstanceState;
  stopRequested?: boolean;
}) =>
  State.updateRecord({
    instanceId,
    change: (record) => ({
      ...record,
      state,
      ...(stopRequested === undefined ? {} : { stopRequested }),
    }),
  });

const isStartable = ({
  existing,
  nowMs,
  desired,
}: {
  existing: InstanceRecord | undefined;
  nowMs: number;
  desired: DesiredInstance;
}) => {
  if (!existing) {
    return true;
  }
  const policy = desired.config.restartPolicy;
  return (
    existing.startAttempts.attempts <= policy.maxRestarts &&
    isReadyToRetry({ window: existing.startAttempts, nowMs, policy })
  );
};

export const startInstance = Effect.fn('startInstance')(function* (desired: DesiredInstance) {
  yield* Effect.annotateCurrentSpan({ instanceId: desired.instanceId, appId: desired.appId });
  const allocator = yield* SlotAllocator;
  const vms = yield* VmManager;
  const nowMs = yield* Clock.currentTimeMillis;
  const existing = (yield* State.snapshot).records.get(desired.instanceId);
  if (!isStartable({ existing, nowMs, desired })) {
    return;
  }

  const slot = yield* allocator.allocate(desired.appId);
  const attempted: InstanceRecord = {
    ...(existing ??
      newInstanceRecord({
        instanceId: desired.instanceId,
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
      window: existing?.startAttempts ?? { attempts: 0 },
      nowMs,
      resetAfterMs: desired.config.restartPolicy.resetAfterMs,
    }),
  };
  yield* State.putRecord(attempted);

  yield* Effect.matchEffect(vms.boot({ desired, slot, dataDevicePath: slot.nbdDevicePath }), {
    onSuccess: () =>
      Effect.gen(function* () {
        yield* State.putRecord({
          ...attempted,
          startedAt: yield* nowTimestamp,
          state: 'starting',
          stopRequested: false,
          health: initialTracker(),
          restartCount: attempted.restartCount + (existing ? ONE_RESTART : NO_RESTART),
          message: undefined,
        });
        yield* State.modify((current) => {
          const nextProbeAtMs = new Map(current.nextProbeAtMs);
          nextProbeAtMs.delete(desired.instanceId);
          return { ...current, nextProbeAtMs };
        });
        yield* Effect.logInfo('instance started').pipe(
          Effect.annotateLogs({
            instanceId: desired.instanceId,
            hostPort: attempted.hostPort,
            guestIpv4: attempted.guestIpv4,
          }),
        );
      }),
    onFailure: (error) =>
      Effect.gen(function* () {
        yield* State.putRecord({
          ...attempted,
          state: 'failed',
          message: reportedMessage(error),
        });
        yield* Effect.logError('instance start failed', error).pipe(
          Effect.annotateLogs({
            instanceId: desired.instanceId,
            attempt: attempted.startAttempts.attempts,
          }),
        );
      }),
  });
});

const probed = ({ record, nowMs }: { record: InstanceRecord; nowMs: number }) =>
  Effect.gen(function* () {
    const healthy = yield* probeInstance({
      guestIpv4: record.guestIpv4,
      guestPort: record.guestPort,
      healthCheck: record.healthCheck,
    });
    yield* State.modify((current) => ({
      ...current,
      nextProbeAtMs: new Map(current.nextProbeAtMs).set(
        record.instanceId,
        nowMs + record.healthCheck.intervalMs,
      ),
    }));
    return applyProbe({
      tracker: record.health,
      healthy,
      at: yield* nowTimestamp,
      healthyThreshold: record.healthCheck.healthyThreshold,
    });
  });

/** Probes the tenants that are due, then settles each state from systemd and the probe together. */
export const refreshStates = Effect.gen(function* () {
  const current = yield* State.snapshot;
  const statuses = yield* Systemd.statuses([...current.records.keys()]);
  const nowMs = yield* Clock.currentTimeMillis;

  yield* Effect.forEach(
    [...current.records.values()],
    (record) =>
      Effect.gen(function* () {
        const status = statuses.get(record.instanceId) ?? UNKNOWN_UNIT;
        const due = nowMs >= (current.nextProbeAtMs.get(record.instanceId) ?? 0);
        const health = status.active && due ? yield* probed({ record, nowMs }) : record.health;

        const state = evaluateInstanceState({
          unit: status,
          tracker: health,
          healthCheck: record.healthCheck,
          desiredRunning: record.desiredRunning,
          stopRequested: record.stopRequested,
          ...(record.startedAt ? { startedAtMs: Date.parse(record.startedAt) } : {}),
          nowMs,
        });

        const changed = state !== record.state;
        yield* State.putRecord({
          ...record,
          health,
          state,
          ...(changed && status.exitCode !== undefined && !status.active
            ? { lastExitCode: status.exitCode }
            : {}),
        });
        if (changed) {
          yield* Effect.logInfo('instance state changed').pipe(
            Effect.annotateLogs({
              instanceId: record.instanceId,
              from: record.state,
              to: state,
            }),
          );
        }
      }),
    { discard: true },
  );
});
