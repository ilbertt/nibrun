import { describe, expect, test } from 'bun:test';
import { FetchHttpClient } from '@effect/platform';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { refreshStates, resumeInstance, suspendInstance } from '#lib/reconcile/instances.ts';
import { SleepRefused, SnapshotUnusable } from '#lib/vm/snapshot.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ArtifactStore, ArtifactTransferError } from '#services/artifact-store.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { ReportSignal } from '#services/report-signal.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';
import { succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  desiredInstance,
  instanceRecord,
  OBSERVED_AT,
} from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';

/** What `systemctl show` says about a microVM that is up, which is all a pass reads off it. */
const ACTIVE_UNIT = [
  'LoadState=loaded',
  'ActiveState=active',
  'SubState=running',
  'Result=success',
  'ExecMainStatus=0',
  'InactiveExitTimestampMonotonic=1',
].join('\n');

/** Far enough out that no instance is due, so a pass turns on the unit alone and never probes. */
const NEVER_DUE = Number.MAX_SAFE_INTEGER;

const run = provided(
  Layer.mergeAll(AgentState.Default, ReportSignal.Default, FetchHttpClient.layer).pipe(
    Layer.provideMerge(platform),
  ),
);

/**
 * A pass held open at the one call it makes before it writes, which is where a reconcile lands in
 * production: the pass has read the record and has yet to say anything about it.
 */
function passHeldOpen() {
  return Effect.gen(function* () {
    const reading = yield* Deferred.make<void>();
    const held = yield* Deferred.make<void>();
    const commands = Layer.succeed(
      CommandRunner,
      CommandRunner.make({
        run: () =>
          Deferred.succeed(reading, undefined).pipe(
            Effect.andThen(Deferred.await(held)),
            Effect.andThen(succeeding({ stdout: ACTIVE_UNIT })),
          ),
      }),
    );
    const pass = yield* Effect.fork(refreshStates.pipe(Effect.provide(commands)));
    yield* Deferred.await(reading);
    return {
      finish: Deferred.succeed(held, undefined).pipe(Effect.andThen(Fiber.join(pass))),
    };
  });
}

const recordOf = Effect.map(AgentState.snapshot, (current) => current.records.get(APP_ID));

/** `systemctl show` answering the same way for every unit a pass asks about. */
const reporting = (unit: string) =>
  Layer.succeed(CommandRunner, CommandRunner.make({ run: () => succeeding({ stdout: unit }) }));

/**
 * The window from the far side, which is the outage this closes: the capture has taken the VMM
 * down and `stopRequested` is not written until it returns, so a pass landing in between finds a
 * microVM that is gone with nothing yet saying it was asked for. Calling that failed drops the
 * app out of desired state, and its hostnames off the proxy with it.
 */
describe('a pass that lands while a snapshot is being taken', () => {
  test('reads the microVM as asleep rather than crashed', () =>
    run(
      Effect.gen(function* () {
        yield* AgentState.putRecord(
          instanceRecord({ onRequest: true, state: 'running', startedAt: OBSERVED_AT }),
        );
        yield* AgentState.markSnapshotting({ appId: APP_ID, active: true });

        yield* refreshStates.pipe(Effect.provide(reporting(INACTIVE_UNIT)));

        const record = yield* recordOf;
        expect(record?.state).toBe('idle');
        expect(record?.message).toBeUndefined();
      }),
    ));

  test('and fails it once the snapshot is no longer in flight', () =>
    run(
      Effect.gen(function* () {
        yield* AgentState.putRecord(
          instanceRecord({ onRequest: true, state: 'running', startedAt: OBSERVED_AT }),
        );

        yield* refreshStates.pipe(Effect.provide(reporting(INACTIVE_UNIT)));

        expect((yield* recordOf)?.state).toBe('failed');
      }),
    ));
});

describe('a settle writes back only what it measured', () => {
  test('a start that lands mid-pass keeps the stop it cleared', () =>
    run(
      Effect.gen(function* () {
        yield* AgentState.putRecord(
          instanceRecord({ state: 'stopped', stopRequested: true, desiredRunning: true }),
        );
        yield* AgentState.modify((current) => ({
          ...current,
          nextProbeAtMs: new Map([[APP_ID, NEVER_DUE]]),
        }));

        const pass = yield* passHeldOpen();
        // Exactly what `startInstance` writes once the boot it was waiting on comes up.
        yield* AgentState.updateRecord({
          appId: APP_ID,
          change: (record) => ({ ...record, state: 'starting', stopRequested: false }),
        });
        yield* pass.finish;

        // Were this put back, the instance would read `stopping` for as long as its unit stayed
        // up: never forwarded, and never started again, because the planner lets it be.
        expect((yield* recordOf)?.stopRequested).toBe(false);
      }),
    ));

  test('an instance dropped mid-pass is not brought back', () =>
    run(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ state: 'running' }));
        yield* AgentState.modify((current) => ({
          ...current,
          nextProbeAtMs: new Map([[APP_ID, NEVER_DUE]]),
        }));

        const pass = yield* passHeldOpen();
        yield* AgentState.dropRecord(APP_ID);
        yield* pass.finish;

        expect(yield* recordOf).toBeUndefined();
      }),
    ));
});

/** What `systemctl show` says about a microVM that is down, which is what a wake has to find. */
const INACTIVE_UNIT = [
  'LoadState=loaded',
  'ActiveState=inactive',
  'SubState=dead',
  'Result=success',
  'ExecMainStatus=0',
  'InactiveExitTimestampMonotonic=1',
].join('\n');

const VM_DIR = '/nonexistent/nibrun-test/vm';

/** Enough that a wake counting one more would be visible, and few enough to leave budget. */
const RESTARTS_SO_FAR = 4;
const NO_ATTEMPTS = 0;

type VmCall = 'boot' | 'sleep' | 'wake' | 'stop' | 'discard';

/**
 * Every way the agent can act on a microVM, recorded rather than performed. Which of them a wake
 * reached is the whole assertion: a restore and a cold boot leave the same app serving, and the
 * only thing that tells them apart from the outside is how long the visitor waited.
 */
function recordingVms({
  onSleep = Effect.succeed(undefined),
  onWake = Effect.void,
}: {
  onSleep?: Effect.Effect<undefined, SleepRefused>;
  onWake?: Effect.Effect<void, SnapshotUnusable>;
} = {}) {
  const calls: VmCall[] = [];
  function taking<A, E>({ call, outcome }: { call: VmCall; outcome: Effect.Effect<A, E> }) {
    return Effect.suspend(() => {
      calls.push(call);
      return outcome;
    });
  }
  return {
    calls,
    layer: Layer.succeed(
      VmManager,
      VmManager.make({
        workingDir: () => VM_DIR,
        boot: () => taking({ call: 'boot', outcome: Effect.void }),
        sleep: () => taking({ call: 'sleep', outcome: onSleep }),
        wake: () => taking({ call: 'wake', outcome: onWake }),
        stop: () => taking({ call: 'stop', outcome: Effect.void }),
        discard: () => taking({ call: 'discard', outcome: Effect.void }),
      }),
    ),
  };
}

/**
 * A stubbed `VmManager` still asks for what a real boot would fetch, so this stands in for the
 * bucket the artifact would come from. Reaching it is the failure: nothing here boots anything.
 */
const noArtifacts = Layer.succeed(
  ArtifactStore,
  ArtifactStore.make({
    open: () => new ArtifactTransferError({ cause: 'no artifact store in a test' }),
  }),
);

function onHost({ vms, unit }: { vms: ReturnType<typeof recordingVms>; unit: string }) {
  const host = Layer.mergeAll(
    agentConfig({ vmDir: VM_DIR }),
    Layer.succeed(CommandRunner, CommandRunner.make({ run: () => succeeding({ stdout: unit }) })),
  );
  return provided(
    Layer.mergeAll(
      AgentState.Default,
      ReportSignal.Default,
      SlotAllocator.DefaultWithoutDependencies,
      ZerofsTopology.DefaultWithoutDependencies,
      noArtifacts,
      vms.layer,
    ).pipe(Layer.provideMerge(host), Layer.provideMerge(platform)),
  );
}

function withMicroVmDown(vms: ReturnType<typeof recordingVms>) {
  return onHost({ vms, unit: INACTIVE_UNIT });
}

/**
 * A wake is a restore, and a cold boot is only what is left when there is nothing to restore.
 * Both halves are checked against the same stub, because which one ran is the difference between
 * a visitor waiting thirty milliseconds and one waiting a second.
 */
describe('an app is woken by putting back the microVM it had', () => {
  test('a snapshot that loads is restored rather than booted', () => {
    const vms = recordingVms();
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'idle' }));

        yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }));

        expect(vms.calls).toEqual(['wake']);
        expect((yield* recordOf)?.startedAt).toBeDefined();
      }),
    );
  });

  // The one path that may cold-boot: a first sleep, a redeploy, a host that rebooted, a guest
  // image that moved. Every other failure leaves the app down and says why.
  test('a snapshot nothing can load is a cold boot instead', () => {
    const vms = recordingVms({
      onWake: new SnapshotUnusable({ reason: 'the host has rebooted' }),
    });
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'idle' }));

        yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }));

        expect(vms.calls).toEqual(['wake', 'boot']);
      }),
    );
  });

  /**
   * An app woken every morning for a year is not an app that crashed three hundred times. The
   * budget still bounds the damage, because the cold boot above is what spends it.
   */
  test('a restore is not a restart, so it costs the app nothing', () => {
    const vms = recordingVms();
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(
          instanceRecord({ onRequest: true, state: 'idle', restartCount: RESTARTS_SO_FAR }),
        );

        yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }));

        const record = yield* recordOf;
        expect(record?.restartCount).toBe(RESTARTS_SO_FAR);
        expect(record?.startAttempts.attempts).toBe(NO_ATTEMPTS);
      }),
    );
  });

  /**
   * The three endings are the same record and the same log line otherwise, and telling them
   * apart is the whole of knowing whether the feature is working: an app that cold-boots every
   * time is one whose snapshots never load, which is indistinguishable from a fast wake until
   * somebody reads the outcome.
   */
  test('a restore says so', () => {
    const vms = recordingVms();
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'idle' }));

        expect(yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }))).toBe(
          'restored',
        );
      }),
    );
  });

  test('a cold boot says so rather than passing for a restore', () => {
    const vms = recordingVms({
      onWake: new SnapshotUnusable({ reason: 'the host has rebooted' }),
    });
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'idle' }));

        expect(yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }))).toBe(
          'cold-boot',
        );
      }),
    );
  });

  test('a wake that found the microVM already up is neither', () => {
    const vms = recordingVms();
    return onHost({ vms, unit: ACTIVE_UNIT })(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'running' }));

        expect(yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }))).toBe(
          'already-running',
        );
      }),
    );
  });

  // Firecracker takes a snapshot load only from a process that has configured nothing, and
  // `systemctl start` on a unit already up is the no-op that would have hidden it.
  test('a microVM that is already up is left alone rather than restored onto', () => {
    const vms = recordingVms();
    return onHost({ vms, unit: ACTIVE_UNIT })(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'running' }));

        yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }));

        expect(vms.calls).toEqual([]);
      }),
    );
  });
});

describe('an app that has gone quiet is put down where it can be picked up', () => {
  const suspend = suspendInstance({ appId: APP_ID, deploymentId: DEPLOYMENT_ID, reason: 'idle' });

  test('it is snapshotted rather than stopped, and reads as asleep after', () => {
    const vms = recordingVms();
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* (yield* SlotAllocator).allocate(APP_ID);
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'running' }));

        yield* suspend;

        expect(vms.calls).toEqual(['sleep']);
        const record = yield* recordOf;
        expect(record?.state).toBe('idle');
        // What tells the health loop a microVM that is gone is asleep rather than crashed, and
        // what keeps the boot after a discarded snapshot from counting as a restart.
        expect(record?.stopRequested).toBe(true);
      }),
    );
  });

  /**
   * A refusal is an outcome, not a failure. `VmManager.sleep` leaves the microVM running, so the
   * app goes on serving and the next measurement tick asks again — and nothing here may mark it
   * failed for having been asked at a moment it could not answer.
   */
  test('one that may not be snapshotted is left up rather than called broken', () => {
    const vms = recordingVms({
      onSleep: new SleepRefused({ reason: 'it has already been asked to stop' }),
    });
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* (yield* SlotAllocator).allocate(APP_ID);
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'running' }));

        yield* suspend;

        expect((yield* recordOf)?.state).toBe('running');
      }),
    );
  });

  /**
   * The mark is what the health loop reads while the capture is in flight, so a sleep that has
   * returned must leave none behind: an app still marked when nothing is snapshotting it is one
   * whose next real crash reads as a sleep and is never failed at all.
   */
  test('the snapshot mark is not left behind, however the sleep ended', () => {
    const vms = recordingVms();
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* (yield* SlotAllocator).allocate(APP_ID);
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'running' }));

        yield* suspend;

        expect((yield* AgentState.snapshot).snapshotting.has(APP_ID)).toBe(false);
      }),
    );
  });

  test('and a refusal clears it too, though it never took one', () => {
    const vms = recordingVms({
      onSleep: new SleepRefused({ reason: 'it has already been asked to stop' }),
    });
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* (yield* SlotAllocator).allocate(APP_ID);
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'running' }));

        yield* suspend;

        expect((yield* AgentState.snapshot).snapshotting.has(APP_ID)).toBe(false);
      }),
    );
  });

  // No slot is no tap, no address and no NBD minor for a restore to land on. Stopping still
  // reclaims the memory, which is what the sleep was for.
  test('one with no slot to come back to is stopped', () => {
    const vms = recordingVms();
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'running' }));

        yield* suspend;

        expect(vms.calls).toEqual(['stop']);
      }),
    );
  });
});
