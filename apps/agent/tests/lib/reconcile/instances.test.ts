import { describe, expect, test } from 'bun:test';
import { FetchHttpClient } from '@effect/platform';
import { DeploymentIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Duration, Effect, Fiber, Layer, TestClock, TestContext } from 'effect';
import { CommandFailed } from '#lib/exec.ts';
import {
  refreshStates,
  resumeInstance,
  startInstance,
  suspendInstance,
} from '#lib/reconcile/instances.ts';
import { VM_RECOVERY_POLICY } from '#lib/vm/recovery.ts';
import { SleepRefused, SnapshotUnusable } from '#lib/vm/snapshot.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { GuestActivity } from '#services/guest-activity.service.ts';
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
  Layer.mergeAll(
    AgentState.Default,
    GuestActivity.Default,
    ReportSignal.Default,
    FetchHttpClient.layer,
  ).pipe(Layer.provideMerge(platform)),
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

  test('and schedules recovery once the snapshot is no longer in flight', () =>
    run(
      Effect.gen(function* () {
        yield* AgentState.putRecord(
          instanceRecord({ onRequest: true, state: 'running', startedAt: OBSERVED_AT }),
        );

        yield* refreshStates.pipe(Effect.provide(reporting(INACTIVE_UNIT)));

        expect((yield* recordOf)?.state).toBe('starting');
        expect((yield* recordOf)?.recovery?.nextAttemptAtMs).toBeDefined();
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

  test('a pass for the outgoing release cannot overwrite the incoming release health or state', () =>
    run(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ state: 'stopped', stopRequested: true }));
        yield* AgentState.modify((current) => ({
          ...current,
          nextProbeAtMs: new Map([[APP_ID, NEVER_DUE]]),
        }));
        const pass = yield* passHeldOpen();
        const incoming = instanceRecord({
          deploymentId: Value.Parse(DeploymentIdSchema, 'dep-2'),
          state: 'starting',
          health: { consecutiveSuccesses: 0, consecutiveFailures: 0, everHealthy: false },
        });
        yield* AgentState.putRecord(incoming);
        yield* pass.finish;
        expect(yield* recordOf).toEqual(incoming);
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

type VmCall = 'boot' | 'sleep' | 'wake' | 'stop' | 'discard';

/**
 * Every way the agent can act on a microVM, recorded rather than performed. Which of them a wake
 * reached is the whole assertion: a restore and a cold boot leave the same app serving, and the
 * only thing that tells them apart from the outside is how long the visitor waited.
 */
function recordingVms({
  onSleep = Effect.succeed(undefined),
  onWake = Effect.void,
  onBoot = Effect.void,
}: {
  onSleep?: Effect.Effect<undefined, SleepRefused>;
  onWake?: Effect.Effect<void, SnapshotUnusable | CommandFailed>;
  onBoot?: Effect.Effect<void, CommandFailed>;
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
        attachReceivers: () => Effect.void,
        boot: () => taking({ call: 'boot', outcome: onBoot }),
        sleep: () => taking({ call: 'sleep', outcome: onSleep }),
        wake: () => taking({ call: 'wake', outcome: onWake }),
        stop: () => taking({ call: 'stop', outcome: Effect.void }),
        discard: () => taking({ call: 'discard', outcome: Effect.void }),
      }),
    ),
  };
}

function onHost({
  vms,
  unit,
  console = '',
}: {
  vms: ReturnType<typeof recordingVms>;
  unit: string;
  console?: string;
}) {
  const host = Layer.mergeAll(
    agentConfig({ vmDir: VM_DIR }),
    Layer.succeed(
      CommandRunner,
      CommandRunner.make({
        run: ({ command }) => succeeding({ stdout: command[0] === 'journalctl' ? console : unit }),
      }),
    ),
  );
  return provided(
    Layer.mergeAll(
      AgentState.Default,
      GuestActivity.Default,
      ReportSignal.Default,
      FetchHttpClient.layer,
      SlotAllocator.DefaultWithoutDependencies,
      ZerofsTopology.DefaultWithoutDependencies,
      vms.layer,
    ).pipe(Layer.provideMerge(host), Layer.provideMerge(platform)),
  );
}

function withMicroVmDown(vms: ReturnType<typeof recordingVms>) {
  return onHost({ vms, unit: INACTIVE_UNIT });
}

const KVM_CONSOLE =
  '2026-10-08T16:31:45.422502 [anonymous-instance:vcpu 0] Received KVM_EXIT_FAIL_ENTRY signal: 7 on cpu 1';
const FAILED_UNIT = INACTIVE_UNIT.replace('ActiveState=inactive', 'ActiveState=failed').replace(
  'ExecMainStatus=0',
  'ExecMainStatus=1',
);

describe('unexpected VM exits recover within a separate budget', () => {
  test('a visitor cannot reboot a crashed VM before the health loop classifies its exit', () => {
    const vms = recordingVms();
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(
          instanceRecord({ state: 'running', startedAt: OBSERVED_AT, onRequest: true }),
        );
        expect(yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }))).toBe(
          'recovering',
        );
        expect(vms.calls).toEqual([]);
        yield* refreshStates;
        expect((yield* recordOf)?.recovery?.nextAttemptAtMs).toBeDefined();
      }),
    );
  });

  test('a failed snapshot restore schedules a cold boot even when the idle VM was deliberately stopped', () => {
    const vms = recordingVms({
      onWake: new CommandFailed({
        command: ['systemctl', 'start'],
        result: { code: 1, stdout: '', stderr: 'restore failed' },
      }),
    });
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(
          instanceRecord({ state: 'idle', onRequest: true, stopRequested: true }),
        );
        yield* Effect.either(resumeInstance(desiredInstance({ desiredState: 'on-request' })));
        expect((yield* recordOf)?.state).toBe('starting');
        expect((yield* recordOf)?.stopRequested).toBe(false);
        yield* TestClock.adjust(Duration.millis(VM_RECOVERY_POLICY.initialBackoffMs));
        yield* startInstance(desiredInstance({ desiredState: 'on-request' }));
        expect(vms.calls).toEqual(['wake', 'boot']);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });

  for (const unit of [INACTIVE_UNIT, FAILED_UNIT]) {
    test(`a KVM exit is retried three times even when systemd says ${unit === INACTIVE_UNIT ? 'success' : 'failure'}`, () => {
      const vms = recordingVms();
      return onHost({ vms, unit, console: KVM_CONSOLE })(
        Effect.gen(function* () {
          yield* AgentState.putRecord(
            instanceRecord({ state: 'running', startedAt: OBSERVED_AT, onRequest: true }),
          );
          for (let attempt = 0; attempt < VM_RECOVERY_POLICY.maxRetries; attempt++) {
            yield* refreshStates;
            const recovering = yield* recordOf;
            expect(recovering?.state).toBe('starting');
            expect(recovering?.recovery?.attempts).toBe(attempt);
            expect((yield* AgentState.snapshot).deferredWork).toBe(true);
            yield* startInstance(desiredInstance({ desiredState: 'on-request' }));
            yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }));
            expect(vms.calls).toHaveLength(attempt);
            yield* TestClock.adjust(Duration.millis(VM_RECOVERY_POLICY.maxBackoffMs));
            yield* startInstance(desiredInstance({ desiredState: 'on-request' }));
            expect(vms.calls).toHaveLength(attempt + 1);
          }
          yield* refreshStates;
          expect((yield* recordOf)?.state).toBe('failed');
          expect((yield* recordOf)?.message).toContain('reason 7 on CPU 1');
          yield* TestClock.adjust('1 day');
          yield* startInstance(desiredInstance({ desiredState: 'on-request' }));
          yield* resumeInstance(desiredInstance({ desiredState: 'on-request' }));
          expect(vms.calls).toEqual(['boot', 'boot', 'boot']);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    });
  }

  test('a tenant that exhausted its own retries is terminal', () => {
    const vms = recordingVms();
    return onHost({
      vms,
      unit: INACTIVE_UNIT,
      console:
        '[nibrun] the tenant used its 5 restarts without staying up; shutting the guest down',
    })(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ startedAt: OBSERVED_AT }));
        yield* refreshStates;
        expect((yield* recordOf)?.state).toBe('failed');
        yield* startInstance(desiredInstance());
        expect(vms.calls).toEqual([]);
      }),
    );
  });

  test('boot failures receive the same bounded retries instead of immediately failing the deployment', () => {
    const vms = recordingVms({
      onBoot: new CommandFailed({
        command: ['systemctl', 'start'],
        result: { code: 1, stdout: '', stderr: 'VM start failed' },
      }),
    });
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* startInstance(desiredInstance());
        expect((yield* recordOf)?.state).toBe('starting');
        for (let retry = 0; retry < VM_RECOVERY_POLICY.maxRetries; retry++) {
          yield* refreshStates;
          expect((yield* recordOf)?.state).toBe('starting');
          yield* TestClock.adjust(Duration.millis(VM_RECOVERY_POLICY.maxBackoffMs));
          yield* startInstance(desiredInstance());
        }
        expect((yield* recordOf)?.state).toBe('failed');
        expect((yield* recordOf)?.message).toContain('VM start failed');
        expect(vms.calls).toEqual(['boot', 'boot', 'boot', 'boot']);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });

  test('a deliberate stop is never recovered even if systemd leaves a failed unit', () => {
    const vms = recordingVms();
    return onHost({ vms, unit: FAILED_UNIT, console: KVM_CONSOLE })(
      Effect.gen(function* () {
        yield* AgentState.putRecord(
          instanceRecord({ startedAt: OBSERVED_AT, desiredRunning: false, stopRequested: true }),
        );
        yield* refreshStates;
        expect((yield* recordOf)?.state).toBe('stopped');
        expect((yield* recordOf)?.recovery).toBeUndefined();
        expect(vms.calls).toEqual([]);
      }),
    );
  });

  test('overlapping reconcile and request starts share a single boot', () => {
    return withMicroVmDown(recordingVms())(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const held = yield* Deferred.make<void>();
        const vms = recordingVms({
          onBoot: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(held))),
        });
        yield* AgentState.putRecord(instanceRecord({ state: 'pending' }));
        const boot = yield* Effect.fork(
          startInstance(desiredInstance()).pipe(Effect.provide(vms.layer)),
        );
        yield* Deferred.await(entered);
        yield* startInstance(desiredInstance()).pipe(Effect.provide(vms.layer));
        yield* resumeInstance(desiredInstance()).pipe(Effect.provide(vms.layer));
        yield* refreshStates;
        expect((yield* recordOf)?.state).toBe('pending');
        expect(vms.calls).toEqual(['boot']);
        yield* Deferred.succeed(held, undefined);
        yield* Fiber.join(boot);
        expect((yield* AgentState.snapshot).starting.size).toBe(0);
      }),
    );
  });
});

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
        expect(record?.recovery).toBeUndefined();
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
  const suspend = suspendInstance({
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    reason: 'idle',
    quietSinceMs: undefined,
  });

  test('a cron run prevents capture through the real suspend path', () => {
    const vms = recordingVms();
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'running' }));
        const activity = yield* GuestActivity;
        yield* activity.run({ appId: APP_ID, effect: suspend });
        expect(vms.calls).toEqual([]);
        expect((yield* recordOf)?.state).toBe('running');
      }),
    );
  });

  test('a completed run invalidates an earlier idle decision', () => {
    const vms = recordingVms();
    return withMicroVmDown(vms)(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ onRequest: true, state: 'running' }));
        const activity = yield* GuestActivity;
        yield* AgentState.markActive({ appId: APP_ID, nowMs: 0 });
        yield* activity.run({ appId: APP_ID, effect: Effect.void });
        yield* suspendInstance({
          appId: APP_ID,
          deploymentId: DEPLOYMENT_ID,
          reason: 'idle',
          quietSinceMs: 0,
        });
        expect(vms.calls).toEqual([]);
      }),
    );
  });

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
