import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { FileSystem } from '@effect/platform';
import { CronJobIdSchema, CronRunIdSchema, DeploymentIdSchema, Value } from '@repo/protocol';
import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref } from 'effect';
import { CronExecutionUnavailable } from '#lib/cron/dispatch.ts';
import { CronDeploymentMismatch } from '#lib/cron/registry.ts';
import { guestVsockPath } from '#lib/vm/vsock.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { AppWaker } from '#services/app-waker.service.ts';
import { CronActivity } from '#services/cron-activity.service.ts';
import { CronExecutions } from '#services/cron-executions.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { TenantLogQueue } from '#services/tenant-log-queue.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import {
  CRON_REPLY,
  type CronGuestScript,
  cronGuestScript,
  cronReplyFrame,
  servingCronGuest,
} from '#tests/support/cron-execution.ts';
import {
  APP_ID,
  desiredInstance,
  desiredState,
  instanceRecord,
  LOG_SOURCE,
} from '#tests/support/fixtures.ts';
import { drainedEvents } from '#tests/support/logs.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(
  Layer.mergeAll(platform, AgentState.Default, CronActivity.Default, TenantLogQueue.Default),
);
const REQUEST = {
  context: {
    ...LOG_SOURCE,
    cronJobId: Value.Parse(CronJobIdSchema, 'job-1'),
    cronRunId: Value.Parse(CronRunIdSchema, 'run-1'),
  },
  job: { schedule: '@hourly', command: 'printf hello' },
};
const NEXT_DEPLOYMENT = Value.Parse(DeploymentIdSchema, 'next-deployment');
const HELD_SCRIPT = cronGuestScript({
  closeAfterFrames: false,
  frames: [
    cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) }),
    cronReplyFrame({ code: CRON_REPLY.stdout, body: Buffer.from('running') }),
  ],
});

function executionHost(script: CronGuestScript) {
  return Effect.gen(function* () {
    const state = yield* AgentState;
    const activity = yield* CronActivity;
    const queue = yield* TenantLogQueue;
    const directory = yield* temporaryDirectory;
    const guest = yield* servingCronGuest({ directory, script });
    yield* (yield* FileSystem.FileSystem).symlink(
      guest.socketPath,
      guestVsockPath({ workingDir: directory }),
    );
    const cache = yield* DesiredStateCache.pipe(
      Effect.provide(
        DesiredStateCache.DefaultWithoutDependencies.pipe(
          Layer.provide(agentConfig({ desiredStateFile: `${directory}/desired.json` })),
        ),
      ),
    );
    yield* cache.accept(desiredState({ instances: [desiredInstance()] }));
    yield* state.modify((current) => ({ ...current, isolated: true }));
    yield* state.putRecord(instanceRecord({ state: 'running' }));
    const woke = yield* Ref.make(0);
    const onWake = yield* Ref.make(Effect.void);
    const received = yield* Deferred.make<void>();
    const dependencies = Layer.mergeAll(
      Layer.succeed(AgentState, state),
      Layer.succeed(CronActivity, activity),
      Layer.succeed(DesiredStateCache, cache),
      Layer.succeed(
        TenantLogQueue,
        TenantLogQueue.make({
          ...queue,
          publish: (event) =>
            queue.publish(event).pipe(Effect.tap(() => Deferred.succeed(received, undefined))),
        }),
      ),
      Layer.succeed(
        AppWaker,
        AppWaker.make({
          wake: () =>
            Effect.gen(function* () {
              yield* Ref.update(woke, (count) => count + 1);
              yield* yield* Ref.get(onWake);
              yield* state.updateRecord({
                appId: APP_ID,
                change: (record) => ({ ...record, state: 'running', stopRequested: false }),
              });
            }),
        }),
      ),
      Layer.succeed(
        VmManager,
        VmManager.make({
          workingDir: () => directory,
          attachReceivers: () => Effect.void,
          boot: () => Effect.void,
          sleep: () => Effect.succeed(undefined),
          wake: () => Effect.void,
          stop: () => Effect.void,
          discard: () => Effect.void,
        }),
      ),
    );
    const services = yield* Layer.build(
      CronExecutions.DefaultWithoutDependencies.pipe(Layer.provide(dependencies)),
    );
    const executions = Context.get(services, CronExecutions);
    yield* executions.syncDeployments({ instances: [desiredInstance()] });
    return { executions, cache, queue, guest, woke, onWake, received };
  });
}

describe('cron dispatch ownership', () => {
  test('executes and logs a running deployment without waking it', () =>
    run(
      Effect.gen(function* () {
        const host = yield* executionHost(
          cronGuestScript({
            frames: [
              cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) }),
              cronReplyFrame({ code: CRON_REPLY.stdout, body: Buffer.from('hello') }),
              ...cronGuestScript().frames.slice(1),
            ],
          }),
        );
        expect(yield* host.executions.execute(REQUEST)).toEqual({ exitCode: 0, signal: undefined });
        expect(yield* Ref.get(host.woke)).toBe(0);
        expect((yield* drainedEvents(host.queue))[0]).toMatchObject({
          ...REQUEST.context,
          text: 'hello',
        });
      }),
    ));

  test('holds idle protection while waking a sleeping app', () =>
    run(
      Effect.gen(function* () {
        const host = yield* executionHost(cronGuestScript());
        const instance = desiredInstance({ desiredState: 'on-request' });
        yield* host.cache.accept(desiredState({ instances: [instance] }));
        yield* AgentState.putRecord(
          instanceRecord({ state: 'idle', stopRequested: true, onRequest: true }),
        );
        const activity = yield* CronActivity;
        const slept = yield* Ref.make(false);
        yield* Ref.set(
          host.onWake,
          activity.whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) }),
        );
        yield* host.executions.execute(REQUEST);
        expect(yield* Ref.get(host.woke)).toBe(1);
        expect(yield* Ref.get(slept)).toBe(false);
      }),
    ));

  test('rechecks deployment ownership after wake before opening the command connection', () =>
    run(
      Effect.gen(function* () {
        const host = yield* executionHost(cronGuestScript());
        yield* host.cache.accept(
          desiredState({ instances: [desiredInstance({ desiredState: 'on-request' })] }),
        );
        yield* AgentState.putRecord(instanceRecord({ state: 'idle', onRequest: true }));
        yield* Ref.set(
          host.onWake,
          host.cache
            .accept(
              desiredState({ instances: [desiredInstance({ deploymentId: NEXT_DEPLOYMENT })] }),
            )
            .pipe(Effect.asVoid, Effect.orDie, Effect.provide(platform)),
        );
        expect(yield* host.executions.execute(REQUEST).pipe(Effect.flip)).toBeInstanceOf(
          CronExecutionUnavailable,
        );
        expect(host.guest.received).toEqual([]);
      }),
    ));

  test.each(['suspended', 'redeployed', 'removed'] as const)(
    '%s apps drain runs before synchronization returns',
    (change) =>
      run(
        Effect.gen(function* () {
          const host = yield* executionHost(HELD_SCRIPT);
          const fiber = yield* host.executions.execute(REQUEST).pipe(Effect.forkScoped);
          yield* Deferred.await(host.received);
          const instances =
            change === 'removed'
              ? []
              : [
                  desiredInstance(
                    change === 'suspended'
                      ? { desiredState: 'stopped' }
                      : { deploymentId: NEXT_DEPLOYMENT },
                  ),
                ];
          yield* host.cache.accept(desiredState({ instances }));
          yield* host.executions.syncDeployments({ instances });
          yield* Effect.promise(() => host.guest.closed);
          expect(Exit.isInterrupted(yield* Fiber.await(fiber))).toBe(true);
          expect(yield* host.executions.execute(REQUEST).pipe(Effect.flip)).toBeInstanceOf(
            CronDeploymentMismatch,
          );
          const slept = yield* Ref.make(false);
          yield* (yield* CronActivity).whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) });
          expect(yield* Ref.get(slept)).toBe(true);
        }),
      ),
  );

  test('unchanged desired state keeps an active command alive', () =>
    run(
      Effect.gen(function* () {
        const host = yield* executionHost(HELD_SCRIPT);
        const fiber = yield* host.executions.execute(REQUEST).pipe(Effect.forkScoped);
        yield* Deferred.await(host.received);
        yield* host.executions.syncDeployments({ instances: [desiredInstance()] });
        expect((yield* Fiber.poll(fiber))._tag).toBe('None');
        yield* Fiber.interrupt(fiber);
        yield* Effect.promise(() => host.guest.closed);
      }),
    ));

  test('a suspended app cannot wake or execute even before synchronization', () =>
    run(
      Effect.gen(function* () {
        const host = yield* executionHost(cronGuestScript());
        yield* host.cache.accept(
          desiredState({ instances: [desiredInstance({ desiredState: 'stopped' })] }),
        );
        expect(yield* host.executions.execute(REQUEST).pipe(Effect.flip)).toBeInstanceOf(
          CronExecutionUnavailable,
        );
        expect(yield* Ref.get(host.woke)).toBe(0);
        expect(host.guest.received).toEqual([]);
      }),
    ));
});
