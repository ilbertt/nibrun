import type {
  AppId,
  DeploymentId,
  DesiredInstance,
  InstanceState,
  Timestamp,
} from '@repo/protocol';
import { Clock, Duration, Effect, Option } from 'effect';
import { isReadyToRetry, nextAttemptWindow } from '#lib/backoff.ts';
import { nowTimestamp } from '#lib/clock.ts';
import { frozen } from '#lib/exports/freeze.ts';
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
import type { AppSlot } from '#lib/network/slot.ts';
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
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ReportSignal } from '#services/report-signal.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

const ONE_RESTART = 1;
const NO_RESTART = 0;

/**
 * Bounded and best-effort. A guest too wedged to answer is exactly the one that has to be taken
 * down, and it would otherwise hold up the deploy replacing it.
 */
const FREEZE_TIMEOUT_SECONDS = 5;
const FREEZE_TIMEOUT = Duration.seconds(FREEZE_TIMEOUT_SECONDS);

/**
 * The disk brought to a point a cold boot can start from, which is what both ways down need first.
 *
 * A microVM is not asked to shut down: the unit signals the VMM, or the VMM is paused where it
 * stands. Freezing is what makes either survivable — the guest checkpoints its ext4 journal, so
 * the writes it had acknowledged are on the device rather than in a page cache that is about to
 * stop existing — and the flush then carries them from ZeroFS to the bucket.
 */
const settled = ({ appId, reason }: { appId: AppId; reason: string }) =>
  Effect.gen(function* () {
    const config = yield* AgentConfig;
    yield* frozen({ appId, vmDir: config.vmDir }).pipe(
      Effect.asVoid,
      Effect.timeout(FREEZE_TIMEOUT),
      Effect.catchAll((error) =>
        Effect.logWarning('stopping a guest that would not freeze', error).pipe(
          Effect.annotateLogs({ appId, reason }),
        ),
      ),
    );
    yield* (yield* ZerofsTopology).flushAll;
  });

/** The freeze is held across the stop: a guest that thawed in between could write behind the flush. */
const settleAndStop = ({ appId, reason }: { appId: AppId; reason: string }) =>
  Effect.gen(function* () {
    const vms = yield* VmManager;
    yield* settled({ appId, reason });
    yield* vms.stop(appId).pipe(
      Effect.andThen(Effect.logInfo('instance stopped')),
      Effect.catchAll((error) => Effect.logError('instance stop failed', error)),
      Effect.annotateLogs({ appId, reason }),
    );
  }).pipe(Effect.scoped);

/**
 * The same settling, with the freeze handed back before the microVM is captured rather than after
 * it is killed.
 *
 * The lease is the vsock connection, and a snapshot is the one way down that outlives the
 * connection it was taken over: a guest captured mid-freeze comes back still holding it, with its
 * tenant blocked on the first write and nothing left on the far side to release it. What the
 * freeze bought is already bought — the journal is checkpointed and the bytes are in the bucket —
 * and `VmManager.sleep` flushes again on its way past, so the writes made in the moment between
 * the thaw and the pause are carried too.
 */
const settleAndSleep = ({
  appId,
  deploymentId,
  slot,
  reason,
}: {
  appId: AppId;
  deploymentId: DeploymentId;
  slot: AppSlot;
  reason: string;
}) =>
  Effect.scoped(settled({ appId, reason })).pipe(
    Effect.andThen(Effect.flatMap(VmManager, (vms) => vms.sleep({ appId, deploymentId, slot }))),
  );

export const stopInstance = Effect.fn('stopInstance')(function* ({
  appId,
  reason,
}: {
  appId: AppId;
  reason: string;
}) {
  yield* Effect.annotateCurrentSpan({ appId, reason });
  yield* setState({ appId, state: 'stopping', stopRequested: true });
  yield* settleAndStop({ appId, reason });
  // The budget goes back with it: a stop that was asked for is not a failed start, and an app
  // suspended while it was struggling to boot would otherwise be one nothing could resume.
  yield* AgentState.updateRecord({
    appId,
    change: (record) => ({ ...record, state: 'stopped', startAttempts: NO_START_ATTEMPTS }),
  });
});

/**
 * A microVM taken down at a point it can be put back on, so the next request restores the guest
 * that was serving rather than booting a new one.
 *
 * `stopRequested` is written after the snapshot and never before it. `VmManager.sleep` refuses a
 * microVM with a stop in flight — waking one lands the guest supervisor's SIGTERM deadline in the
 * past — so setting the flag first, the way `stopInstance` does, would refuse every sleep this
 * asked for. It still has to be written afterwards: it is what tells the health loop that a
 * microVM that is gone is asleep rather than crashed, and what keeps the boot that follows a
 * discarded snapshot from being counted as a restart.
 *
 * Which leaves the capture itself, at the end of which the VMM is gone and the flag is not yet
 * written. `markSnapshotting` spans exactly that, because the health loop runs on its own tick
 * and one landing in there would read the sleep as the crash `stopRequested` exists to rule out.
 * It is cleared however this ends: a refusal leaves the microVM up, and an app marked as being
 * captured when nothing is capturing it is one whose next real crash reads as a sleep.
 *
 * The state stays `running` for the whole of it rather than going to `stopping` the way a stop
 * does. That keeps the forward rule pointing at the guest while it is being captured, which is
 * what the requests still arriving want: withdrawing it would hand them to the activator, which
 * would find the unit still up, take that as nothing to wake, and probe a paused guest until the
 * grace period ran out.
 *
 * Neither a refusal nor a VMM that would not take the snapshot is a failure here. `sleep` leaves
 * the microVM running either way and the record untouched, so the app goes on serving and the
 * next measurement tick asks again — which is the safe end of this to be wrong at.
 */
export const suspendInstance = Effect.fn('suspendInstance')(function* ({
  appId,
  deploymentId,
  reason,
}: {
  appId: AppId;
  deploymentId: DeploymentId;
  reason: string;
}) {
  yield* Effect.annotateCurrentSpan({ appId, reason });
  const slot = yield* (yield* SlotAllocator).lookup(appId);
  if (Option.isNone(slot)) {
    // No slot is no tap, no address and no NBD minor for a restore to land on, so there is
    // nothing a snapshot could be loaded against. Stopping still reclaims the memory.
    return yield* stopInstance({ appId, reason });
  }

  yield* AgentState.markSnapshotting({ appId, active: true });
  yield* settleAndSleep({ appId, deploymentId, slot: slot.value, reason }).pipe(
    Effect.andThen(
      AgentState.updateRecord({
        appId,
        change: (record) => ({
          ...record,
          state: 'idle',
          stopRequested: true,
          startAttempts: NO_START_ATTEMPTS,
          message: undefined,
        }),
      }),
    ),
    // Loud, and carrying which refusal it was. `hasGoneQuiet` has already excluded every reason
    // `VmManager.sleep` can refuse for something about this app, so one that reaches here is
    // either a stop that landed in the moment since the records were read or a refusal about the
    // host itself — and the second is an operator's to go and look at rather than a tenant's.
    Effect.catchTag('SleepRefused', (refusal) =>
      Effect.logWarning(
        `this microVM may not be snapshotted, so it stays up: ${refusal.reason}`,
      ).pipe(Effect.annotateLogs({ appId, reason })),
    ),
    Effect.catchAll((error) =>
      Effect.logWarning('this microVM would not sleep; leaving it up', error).pipe(
        Effect.annotateLogs({ appId, reason }),
      ),
    ),
    Effect.ensuring(AgentState.markSnapshotting({ appId, active: false })),
  );
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

/**
 * What desired state says about an app, as the record's own fields. Named once because a start
 * and a sleep write the same ones, and a field only one of them carried would be a record whose
 * contents depended on how the app happened to come to be here.
 */
function recordFields({ desired, slot }: { desired: DesiredInstance; slot: AppSlot }) {
  return {
    appId: desired.appId,
    deploymentId: desired.deploymentId,
    volumeId: desired.volumeId,
    hostnames: desired.hostnames,
    hostPort: slot.hostPort,
    httpPort: desired.config.httpPort,
    hasExtraPublicPort: desired.config.hasExtraPublicPort,
    guestIpv4: slot.guestIpv4,
    artifactDigest: desired.artifact.digest,
    healthCheck: desired.config.healthCheck,
    resources: desired.config.resources,
    desiredRunning: true,
    onRequest: desired.desiredState === 'on-request',
  };
}

/**
 * An app that should be reachable with no microVM behind it yet. It takes a slot and a record
 * like any other instance, because those are what a request has to find: the slot is the port
 * the proxy is sent to and the activator listens on, and the record is what the routing config
 * is rendered from. An app nobody has visited is still an app this host answers for.
 *
 * The state is left to the health loop, which reads `idle` off the same record. Writing it here
 * would let a reconcile landing mid-boot overwrite a microVM that is on its way up.
 */
export const sleepInstance = Effect.fn('sleepInstance')(function* (desired: DesiredInstance) {
  yield* Effect.annotateCurrentSpan({ appId: desired.appId });
  const allocator = yield* SlotAllocator;
  const slot = yield* allocator.allocate(desired.appId);
  const existing = (yield* AgentState.snapshot).records.get(desired.appId);
  const fields = recordFields({ desired, slot });

  yield* AgentState.putRecord(
    existing
      ? { ...existing, ...fields }
      : newInstanceRecord({ ...fields, state: 'idle', health: initialTracker() }),
  );
  if (!existing) {
    yield* Effect.logInfo('app is waiting to be asked for').pipe(
      Effect.annotateLogs({ appId: desired.appId, hostPort: slot.hostPort }),
    );
  }
});

/** A microVM that has just come up is not left waiting on a delay measured for the one before it. */
function probeAtOnce(appId: AppId) {
  return AgentState.modify((current) => {
    const nextProbeAtMs = new Map(current.nextProbeAtMs);
    nextProbeAtMs.delete(appId);
    return { ...current, nextProbeAtMs };
  });
}

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
        ...recordFields({ desired, slot }),
        state: 'pending',
        health: initialTracker(),
      })),
    startAttempts: nextAttemptWindow({
      window: existing?.startAttempts ?? NO_START_ATTEMPTS,
      nowMs,
      resetAfterMs: desired.config.restartPolicy.resetAfterMs,
    }),
    // Whatever asked for the stop has been overtaken by whatever asked for this: an instance
    // being started is one nobody is waiting to see go down, and leaving the flag set would have
    // a wake that failed read as a sleeping app rather than a broken one.
    stopRequested: false,
  };
  yield* AgentState.putRecord(attempted);
  // Before the boot rather than after: the clock this starts is the one that decides when the
  // app may sleep again, and a boot that takes seconds must not spend them.
  yield* AgentState.markActive({ appId: desired.appId, nowMs });

  yield* Effect.matchEffect(vms.boot({ desired, slot, dataDevicePath: slot.nbdDevicePath }), {
    onSuccess: () =>
      Effect.gen(function* () {
        yield* AgentState.putRecord({
          ...attempted,
          startedAt: yield* nowTimestamp,
          state: 'starting',
          health: initialTracker(),
          restartCount: attempted.restartCount + (restarted(existing) ? ONE_RESTART : NO_RESTART),
          message: undefined,
        });
        yield* probeAtOnce(desired.appId);
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

/**
 * What a restore writes back, which is a great deal less than a start does.
 *
 * The health tracker is carried across rather than reset: it describes the guest being restored
 * and is still true of it, where clearing it would say this app had never answered — the one
 * thing that stops it being allowed to sleep again. `startedAt` is not carried across, because
 * every health decision is measured from it and the grace period belongs to this run.
 */
function restored({ appId, startedAt }: { appId: AppId; startedAt: Timestamp }) {
  return AgentState.updateRecord({
    appId,
    change: (record) => ({
      ...record,
      state: 'starting',
      startedAt,
      stopRequested: false,
      message: undefined,
    }),
  }).pipe(Effect.andThen(probeAtOnce(appId)));
}

/**
 * The microVM an idle app had, back where it was — and a cold boot only where there is nothing to
 * come back to.
 *
 * None of the accounting a start does. No attempt is charged to the restart budget and
 * `restartCount` does not move, because a wake is not a restart: an app woken every morning for a
 * year would otherwise report three hundred crashes. The budget still bounds the damage, because
 * the fallback below is a start and a start is what spends it — so a snapshot that will never
 * load degrades into cold boots that give up, while a restore that works costs nothing.
 *
 * `SnapshotUnusable` is the only failure that boots instead. Every other one leaves the app down
 * with the reason on its record: `VmManager.wake` discards the snapshot on its way out, so the
 * request after this one is the cold boot rather than a second attempt at the same restore.
 */
/**
 * Which of the three ways a wake can end. Returned rather than inferred from the record, because
 * a cold boot and a restore leave the same record behind and only this can tell them apart —
 * which is the difference between the feature working and it quietly not.
 */
export type WakeOutcome = 'restored' | 'already-running' | 'cold-boot';

export const resumeInstance = Effect.fn('resumeInstance')(function* (desired: DesiredInstance) {
  yield* Effect.annotateCurrentSpan({ appId: desired.appId });
  const allocator = yield* SlotAllocator;
  const vms = yield* VmManager;
  const slot = yield* allocator.allocate(desired.appId);

  // Asked of systemd rather than of the record, because the record is a cache and this is a
  // precondition: Firecracker takes `PUT /snapshot/load` only from a process that has configured
  // nothing, and `systemctl start` on a unit already up is the no-op that would have let the load
  // reach a booted microVM and be refused there. Nothing to wake is not a failure — whatever is
  // waiting on this is about to be answered by the guest that is already there.
  const unit = (yield* Systemd.statuses([desired.appId])).get(desired.appId) ?? UNKNOWN_UNIT;
  if (unit.active) {
    return 'already-running' as const;
  }

  // For the reason `startInstance` marks one before its boot: the clock this starts is the one
  // that decides when the app may sleep again.
  yield* AgentState.markActive({
    appId: desired.appId,
    nowMs: yield* Clock.currentTimeMillis,
  });

  return yield* vms.wake({ appId: desired.appId, deploymentId: desired.deploymentId, slot }).pipe(
    Effect.andThen(
      Effect.flatMap(nowTimestamp, (startedAt) => restored({ appId: desired.appId, startedAt })),
    ),
    Effect.as('restored' as const),
    Effect.catchTag('SnapshotUnusable', (unusable) =>
      Effect.logInfo('nothing to wake this app from; booting it instead', unusable)
        .pipe(Effect.annotateLogs({ appId: desired.appId }))
        .pipe(Effect.andThen(startInstance(desired)))
        .pipe(Effect.as('cold-boot' as const)),
    ),
    Effect.tapError((error) =>
      AgentState.updateRecord({
        appId: desired.appId,
        change: (record) => ({ ...record, message: reportedMessage(error) }),
      }),
    ),
  );
});

/** Only a failure has anything to say: every other state is its own account of itself. */
const verdict = Effect.fn('verdict')(function* ({
  state,
  status,
  health,
  record,
}: {
  state: InstanceState;
  status: UnitStatus;
  health: HealthTracker;
  record: InstanceRecord;
}) {
  if (state !== 'failed') {
    return undefined;
  }
  // Only a VM that stopped has left a console to read, and only one this agent started has a run
  // to bound that read to.
  const guestVerdict =
    status.active || record.startedAt === undefined
      ? undefined
      : yield* Systemd.guestVerdict({ appId: record.appId, sinceMs: Date.parse(record.startedAt) });
  return describeInstanceFailure({
    unit: status,
    tracker: health,
    healthCheck: record.healthCheck,
    httpPort: record.httpPort,
    ...(guestVerdict !== undefined ? { guestVerdict } : {}),
  });
});

function probed({ record, nowMs }: { record: InstanceRecord; nowMs: number }) {
  return Effect.gen(function* () {
    const healthy = yield* probeInstance({
      guestIpv4: record.guestIpv4,
      httpPort: record.httpPort,
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

/**
 * What this pass measured is merged into the record as it stands, never written over it. A probe
 * is the longest thing the loop does, and a reconcile landing a start while one runs has already
 * cleared the `stopRequested` the pass read: writing the whole record back would put that flag on
 * again, and an instance carrying it is `stopping` for as long as its unit is up — a state nothing
 * forwards to and no later pass leaves, because the planner lets a running unit be. Merging is
 * also what keeps an instance dropped mid-pass dropped.
 */
function settle({
  record,
  status,
  due,
  snapshotting,
  nowMs,
}: {
  record: InstanceRecord;
  status: UnitStatus;
  due: boolean;
  snapshotting: boolean;
  nowMs: number;
}) {
  return Effect.gen(function* () {
    const health = status.active && due ? yield* probed({ record, nowMs }) : record.health;
    const state = evaluateInstanceState({
      unit: status,
      tracker: health,
      desiredRunning: record.desiredRunning,
      onRequest: record.onRequest,
      stopRequested: record.stopRequested,
      snapshotting,
      ...graceInputs({ record, nowMs }),
    });

    if (state === record.state) {
      return yield* AgentState.updateRecord({
        appId: record.appId,
        change: (latest) => ({ ...latest, health }),
      });
    }

    // Cleared as readily as it is written: a message outliving the state it explains is
    // read as an account of the state that replaced it.
    const message = yield* verdict({ state, status, health, record });
    yield* AgentState.updateRecord({
      appId: record.appId,
      change: (latest) => ({
        ...latest,
        health,
        state,
        ...(status.exitCode !== undefined && !status.active
          ? { lastExitCode: status.exitCode }
          : {}),
        message,
      }),
    });
    yield* Effect.logInfo('instance state changed').pipe(
      Effect.annotateLogs({
        appId: record.appId,
        from: record.state,
        to: state,
      }),
    );
    yield* ReportSignal.raise;
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
      settle({
        record,
        status: statuses.get(record.appId) ?? UNKNOWN_UNIT,
        due: nowMs >= (current.nextProbeAtMs.get(record.appId) ?? 0),
        snapshotting: current.snapshotting.has(record.appId),
        nowMs,
      }),
    { discard: true },
  );
});
