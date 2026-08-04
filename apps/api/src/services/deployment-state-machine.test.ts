import { describe, expect, test } from 'bun:test';
import type { DeploymentId, HostReportedState } from '@repo/protocol';
import * as Effect from 'effect/Effect';
import * as Either from 'effect/Either';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as TestClock from 'effect/TestClock';
import * as TestContext from 'effect/TestContext';
import {
  DeploymentPersistenceError,
  type DeploymentStateSnapshot,
  DeploymentStateStore,
  type DeploymentTransition,
} from '#repositories/deployment.repository.ts';
import {
  DeploymentEvent,
  DeploymentStateMachine,
  DeploymentStateMachineLive,
} from '#services/deployment-state-machine.ts';

const DEPLOYMENT_ID = '019cc8ab-b8a0-7000-8000-000000000001' as DeploymentId;
const UNKNOWN_DEPLOYMENT_ID = '019cc8ab-b8a0-7000-8000-000000000002' as DeploymentId;
const DEADLINE = new Date('2026-08-04T12:05:00.000Z');
const ACTIVATED_AT = new Date('2026-08-04T12:01:00.000Z');

type MemoryStateStore = {
  layer: Layer.Layer<DeploymentStateStore>;
  states: Map<DeploymentId, DeploymentStateSnapshot>;
  transitionCalls(): number;
};

function snapshot({
  state = 'pending',
  targetGeneration = null,
  deadlineAt = null,
  activatedAt = null,
  failureReason = null,
}: Partial<Omit<DeploymentStateSnapshot, 'id'>> = {}): DeploymentStateSnapshot {
  return {
    id: DEPLOYMENT_ID,
    state,
    targetGeneration,
    deadlineAt,
    activatedAt,
    failureReason,
  };
}

function makeMemoryStateStore({
  initial,
  conflicts = 0,
}: {
  initial: readonly DeploymentStateSnapshot[];
  conflicts?: number;
}): MemoryStateStore {
  const states = new Map(initial.map((deployment) => [deployment.id, deployment]));
  let conflictsRemaining = conflicts;
  let writes = 0;

  function find({ deploymentId }: { deploymentId: DeploymentId }) {
    return Effect.sync(() => Option.fromNullable(states.get(deploymentId)));
  }

  function findExpired({ asOf, limit }: { asOf: Date; limit: number }) {
    return Effect.sync(() =>
      Array.from(states.values())
        .filter(
          (deployment) =>
            deployment.state === 'starting' &&
            deployment.deadlineAt !== null &&
            deployment.deadlineAt <= asOf,
        )
        .slice(0, limit),
    );
  }

  function transition(input: DeploymentTransition) {
    return Effect.sync(() => {
      writes += 1;
      if (conflictsRemaining > 0) {
        conflictsRemaining -= 1;
        return Option.none<DeploymentStateSnapshot>();
      }
      const current = states.get(input.deploymentId);
      if (!current || current.state !== input.expectedState) {
        return Option.none<DeploymentStateSnapshot>();
      }
      const next = { id: input.deploymentId, ...input.next };
      states.set(input.deploymentId, next);
      return Option.some(next);
    });
  }

  return {
    states,
    layer: Layer.succeed(DeploymentStateStore, { find, findExpired, transition }),
    transitionCalls() {
      return writes;
    },
  };
}

function runStateMachineWithLayer<A, E>({
  program,
  storeLayer,
}: {
  program: Effect.Effect<A, E, DeploymentStateMachine>;
  storeLayer: Layer.Layer<DeploymentStateStore>;
}): Promise<A> {
  const live = DeploymentStateMachineLive.pipe(Layer.provide(storeLayer));
  return Effect.runPromise(program.pipe(Effect.provide(live)));
}

function runStateMachine<A, E>({
  program,
  store,
}: {
  program: Effect.Effect<A, E, DeploymentStateMachine>;
  store: MemoryStateStore;
}): Promise<A> {
  return runStateMachineWithLayer({ program, storeLayer: store.layer });
}

describe('DeploymentStateMachine', () => {
  test('schedules a pending deployment with its desired-state generation and deadline', async () => {
    const store = makeMemoryStateStore({ initial: [snapshot()] });

    const result = await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.Scheduled({ targetGeneration: 7, deadlineAt: DEADLINE }),
      }),
    });

    expect(result._tag).toBe('Transitioned');
    expect(store.states.get(DEPLOYMENT_ID)).toEqual(
      snapshot({ state: 'starting', targetGeneration: 7, deadlineAt: DEADLINE }),
    );
  });

  test('treats repeated scheduling and stale observations as idempotent', async () => {
    const starting = snapshot({ state: 'starting', targetGeneration: 7, deadlineAt: DEADLINE });
    const store = makeMemoryStateStore({ initial: [starting] });

    const scheduled = await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.Scheduled({ targetGeneration: 7, deadlineAt: DEADLINE }),
      }),
    });
    const staleReport = await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.InstanceReported({
          observedGeneration: 6,
          instanceState: 'running',
          reportedAt: ACTIVATED_AT,
          message: null,
        }),
      }),
    });

    expect(scheduled._tag).toBe('Unchanged');
    expect(staleReport._tag).toBe('Unchanged');
    expect(store.transitionCalls()).toBe(0);
  });

  test('recognizes a replayed schedule after the deployment has progressed', async () => {
    const store = makeMemoryStateStore({
      initial: [
        snapshot({
          state: 'active',
          targetGeneration: 7,
          deadlineAt: DEADLINE,
          activatedAt: ACTIVATED_AT,
        }),
      ],
    });

    const result = await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.Scheduled({ targetGeneration: 7, deadlineAt: DEADLINE }),
      }),
    });

    expect(result._tag).toBe('Unchanged');
    expect(store.transitionCalls()).toBe(0);
  });

  test('activates only from a report that observed the target generation', async () => {
    const store = makeMemoryStateStore({
      initial: [snapshot({ state: 'starting', targetGeneration: 7, deadlineAt: DEADLINE })],
    });

    const result = await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.InstanceReported({
          observedGeneration: 7,
          instanceState: 'running',
          reportedAt: ACTIVATED_AT,
          message: null,
        }),
      }),
    });

    expect(result._tag).toBe('Transitioned');
    expect(store.states.get(DEPLOYMENT_ID)).toEqual(
      snapshot({
        state: 'active',
        targetGeneration: 7,
        deadlineAt: DEADLINE,
        activatedAt: ACTIVATED_AT,
      }),
    );
  });

  test('preserves the agent failure reason for operators', async () => {
    const store = makeMemoryStateStore({
      initial: [snapshot({ state: 'starting', targetGeneration: 7, deadlineAt: DEADLINE })],
    });

    await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.InstanceReported({
          observedGeneration: 7,
          instanceState: 'failed',
          reportedAt: ACTIVATED_AT,
          message: 'guest process exited before becoming healthy',
        }),
      }),
    });

    expect(store.states.get(DEPLOYMENT_ID)?.failureReason).toBe(
      'guest process exited before becoming healthy',
    );
  });

  test('re-reads state and retries only a compare-and-set conflict', async () => {
    const store = makeMemoryStateStore({ initial: [snapshot()], conflicts: 1 });

    const result = await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.Scheduled({ targetGeneration: 7, deadlineAt: DEADLINE }),
      }),
    });

    expect(result._tag).toBe('Transitioned');
    expect(store.transitionCalls()).toBe(2);
  });

  test('does not retry persistence failures', async () => {
    let findCalls = 0;
    const storeLayer = Layer.succeed(DeploymentStateStore, {
      find() {
        findCalls += 1;
        return Effect.fail(
          new DeploymentPersistenceError({ operation: 'find', cause: new Error('offline') }),
        );
      },
      findExpired() {
        return Effect.succeed([]);
      },
      transition() {
        return Effect.succeed(Option.none());
      },
    });

    const result = await runStateMachineWithLayer({
      storeLayer,
      program: Effect.either(
        DeploymentStateMachine.transition({
          deploymentId: DEPLOYMENT_ID,
          event: DeploymentEvent.CancellationRequested(),
        }),
      ),
    });

    expect(Either.isLeft(result)).toBe(true);
    expect(findCalls).toBe(1);
  });

  test('makes cancellation idempotent while a deployment is converging', async () => {
    const store = makeMemoryStateStore({ initial: [snapshot()] });

    const first = await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.CancellationRequested(),
      }),
    });
    const repeated = await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.CancellationRequested(),
      }),
    });

    expect(first._tag).toBe('Transitioned');
    expect(repeated._tag).toBe('Unchanged');
    expect(store.states.get(DEPLOYMENT_ID)?.state).toBe('cancelled');
  });

  test('supersedes an active deployment when its replacement is active', async () => {
    const store = makeMemoryStateStore({
      initial: [
        snapshot({
          state: 'active',
          targetGeneration: 7,
          deadlineAt: DEADLINE,
          activatedAt: ACTIVATED_AT,
        }),
      ],
    });

    const result = await runStateMachine({
      store,
      program: DeploymentStateMachine.transition({
        deploymentId: DEPLOYMENT_ID,
        event: DeploymentEvent.ReplacementActivated({ at: new Date('2026-08-04T12:02:00.000Z') }),
      }),
    });

    expect(result._tag).toBe('Transitioned');
    expect(store.states.get(DEPLOYMENT_ID)?.state).toBe('superseded');
  });

  test('rejects transitions that the state algebra does not define', async () => {
    const store = makeMemoryStateStore({
      initial: [
        snapshot({
          state: 'active',
          targetGeneration: 7,
          deadlineAt: DEADLINE,
          activatedAt: ACTIVATED_AT,
        }),
      ],
    });

    const result = await runStateMachine({
      store,
      program: Effect.either(
        DeploymentStateMachine.transition({
          deploymentId: DEPLOYMENT_ID,
          event: DeploymentEvent.CancellationRequested(),
        }),
      ),
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('InvalidDeploymentTransition');
    }
  });

  test('expires overdue deployments using the Effect clock', async () => {
    const store = makeMemoryStateStore({
      initial: [snapshot({ state: 'starting', targetGeneration: 7, deadlineAt: DEADLINE })],
    });
    const live = DeploymentStateMachineLive.pipe(Layer.provide(store.layer));
    const program = Effect.gen(function* () {
      yield* TestClock.setTime(new Date('2026-08-04T12:06:00.000Z'));
      return yield* DeploymentStateMachine.expireOverdue({ limit: 10 });
    }).pipe(Effect.provide(live), Effect.provide(TestContext.TestContext));

    const results = await Effect.runPromise(program);

    expect(results).toHaveLength(1);
    expect(store.states.get(DEPLOYMENT_ID)?.state).toBe('failed');
  });

  test('uses reports as level-triggered observations and ignores unknown deployments', async () => {
    const store = makeMemoryStateStore({
      initial: [snapshot({ state: 'starting', targetGeneration: 7, deadlineAt: DEADLINE })],
    });
    const report = {
      hostId: '019cc8ab-b8a0-7000-8000-000000000003',
      observedGeneration: 7,
      reportedAt: ACTIVATED_AT.toISOString(),
      state: 'ready',
      capacity: { vcpuCount: 2, memoryMib: 2048, cacheBytes: 1024 },
      allocatable: { vcpuCount: 1, memoryMib: 1024, cacheBytes: 512 },
      versions: {
        agent: 'test',
        guestImage: 'test',
        zerofs: 'test',
        firecracker: 'test',
      },
      volumes: [],
      instances: [
        {
          instanceId: '019cc8ab-b8a0-7000-8000-000000000004',
          deploymentId: DEPLOYMENT_ID,
          state: 'running',
          restartCount: 0,
        },
        {
          instanceId: '019cc8ab-b8a0-7000-8000-000000000005',
          deploymentId: UNKNOWN_DEPLOYMENT_ID,
          state: 'running',
          restartCount: 0,
        },
      ],
      checkpoints: [],
      exports: [],
    } as unknown as HostReportedState;

    const results = await runStateMachine({
      store,
      program: DeploymentStateMachine.observeReport(report),
    });

    expect(results).toHaveLength(1);
    expect(store.states.get(DEPLOYMENT_ID)?.state).toBe('active');
  });
});
