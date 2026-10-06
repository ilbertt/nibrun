import { describe, expect, test } from 'bun:test';
import { CronJobIdSchema, CronRunIdSchema, DeploymentIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Clock, Context, Effect, Layer, Ref, TestClock, TestContext } from 'effect';
import { cronLoop } from '#lib/agent/crons.ts';
import { type CronDispatch, CronExecutionUnavailable } from '#lib/cron/dispatch.ts';
import { registeredCronJobs } from '#lib/cron/jobs.ts';
import { CronExecutions } from '#services/cron-executions.service.ts';
import { CronRegistry } from '#services/cron-registry.service.ts';
import { CronScheduler } from '#services/cron-scheduler.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  desiredInstance,
  desiredState,
  LOG_SOURCE,
} from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(Layer.mergeAll(platform, TestContext.TestContext));
const JOB = { schedule: '* * * * *', command: 'printf first' };
const NEXT_JOB = { ...JOB, command: 'printf second' };
const NEXT_DEPLOYMENT = Value.Parse(DeploymentIdSchema, 'next-deployment');
const THREE_RUNS = 3;

function schedulerHost() {
  return Effect.gen(function* () {
    const directory = yield* temporaryDirectory;
    const requests: (CronDispatch & { atMs: number })[] = [];
    const active = yield* Ref.make(0);
    const onRun = yield* Ref.make<Effect.Effect<void, CronExecutionUnavailable>>(Effect.void);
    const execution = Layer.succeed(
      CronExecutions,
      CronExecutions.make({
        syncDeployments: () => Effect.void,
        execute: (request) =>
          Effect.acquireUseRelease(
            Ref.update(active, (count) => count + 1).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  requests.push({ ...request, atMs: yield* Clock.currentTimeMillis });
                }),
              ),
            ),
            () =>
              Effect.flatten(Ref.get(onRun)).pipe(Effect.as({ exitCode: 0, signal: undefined })),
            () => Ref.update(active, (count) => count - 1),
          ),
      }),
    );
    const dependencies = Layer.mergeAll(
      CronRegistry.DefaultWithoutDependencies,
      DesiredStateCache.DefaultWithoutDependencies,
      execution,
    ).pipe(
      Layer.provide(
        agentConfig({
          cronRegistryFile: `${directory}/crons.json`,
          desiredStateFile: `${directory}/desired.json`,
        }),
      ),
    );
    const services = yield* Layer.build(
      CronScheduler.DefaultWithoutDependencies.pipe(Layer.provideMerge(dependencies)),
    );
    const registry = Context.get(services, CronRegistry);
    const cache = Context.get(services, DesiredStateCache);
    const scheduler = Context.get(services, CronScheduler);
    yield* cache.accept(desiredState({ instances: [desiredInstance()] }));
    yield* registry.beginDeployment(LOG_SOURCE);
    yield* registry.replace({ ...LOG_SOURCE, jobs: [JOB] });
    yield* scheduler.sync;
    return { registry, cache, scheduler, requests, active, onRun };
  });
}

describe('scoped cron scheduling', () => {
  test('synchronizes on registry changes without polling between occurrences', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* host.registry.changed;
        const synchronizations = yield* Ref.make(0);
        const scheduler = CronScheduler.make({
          sync: Ref.update(synchronizations, (count) => count + 1).pipe(
            Effect.andThen(host.scheduler.sync),
          ),
        });
        yield* cronLoop.pipe(
          Effect.provideService(CronScheduler, scheduler),
          Effect.provideService(CronRegistry, host.registry),
          Effect.forkScoped,
        );
        yield* TestClock.adjust('2 minutes');
        expect(yield* Ref.get(synchronizations)).toBe(1);
        expect(host.requests).toHaveLength(2);
        yield* host.registry.replace({ ...LOG_SOURCE, jobs: [NEXT_JOB] });
        yield* TestClock.adjust('1 minute');
        expect(yield* Ref.get(synchronizations)).toBe(2);
        expect(host.requests.at(-1)?.job).toEqual(NEXT_JOB);
      }),
    ));

  test('retries failed synchronization and then waits for a registry change', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* host.registry.changed;
        const attempts = yield* Ref.make(0);
        const scheduler = CronScheduler.make({
          sync: Ref.updateAndGet(attempts, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1 ? Effect.die('synchronization failed') : host.scheduler.sync,
            ),
          ),
        });
        yield* cronLoop.pipe(
          Effect.provideService(CronScheduler, scheduler),
          Effect.provideService(CronRegistry, host.registry),
          Effect.forkScoped,
        );
        yield* TestClock.adjust('999 millis');
        expect(yield* Ref.get(attempts)).toBe(1);
        yield* TestClock.adjust('1 millis');
        expect(yield* Ref.get(attempts)).toBe(2);
        yield* TestClock.adjust('2 minutes');
        expect(yield* Ref.get(attempts)).toBe(2);
      }),
    ));

  test('deployment notifications suspend and resume unchanged registrations', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* cronLoop.pipe(
          Effect.provideService(CronScheduler, host.scheduler),
          Effect.provideService(CronRegistry, host.registry),
          Effect.forkScoped,
        );
        yield* TestClock.adjust('30 seconds');
        const suspended = desiredState({
          instances: [desiredInstance({ desiredState: 'stopped' })],
        });
        yield* host.cache.accept(suspended);
        yield* host.registry.syncDeployments({ deployments: suspended.instances });
        yield* TestClock.adjust('10 minutes');
        expect(host.requests).toEqual([]);
        expect((yield* host.registry.get({ appId: APP_ID }))._tag).toBe('Some');
        const resumed = desiredState({ instances: [desiredInstance()] });
        yield* host.cache.accept(resumed);
        yield* host.registry.syncDeployments({ deployments: resumed.instances });
        yield* TestClock.adjust('30 seconds');
        expect(host.requests).toHaveLength(1);
      }),
    ));

  test('a registration just before an occurrence refreshes timers immediately', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* cronLoop.pipe(
          Effect.provideService(CronScheduler, host.scheduler),
          Effect.provideService(CronRegistry, host.registry),
          Effect.forkScoped,
        );
        yield* TestClock.adjust('59 seconds');
        yield* TestClock.adjust('500 millis');
        yield* host.registry.replace({ ...LOG_SOURCE, jobs: [NEXT_JOB] });
        yield* TestClock.adjust('500 millis');
        expect(host.requests).toHaveLength(1);
        expect(host.requests[0]?.job).toEqual(NEXT_JOB);
      }),
    ));
  test('waits for the first occurrence and assigns a distinct run ID each time', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        expect(host.requests).toEqual([]);
        yield* TestClock.adjust('1 minute');
        expect(host.requests).toHaveLength(1);
        yield* TestClock.adjust('1 minute');
        expect(host.requests).toHaveLength(2);
        expect(host.requests[0]?.context.cronJobId).toBe(host.requests[1]?.context.cronJobId);
        expect(host.requests[0]?.context.cronRunId).not.toBe(host.requests[1]?.context.cronRunId);
        for (const request of host.requests) {
          expect(Value.Check(CronJobIdSchema, request.context.cronJobId)).toBe(true);
          expect(Value.Check(CronRunIdSchema, request.context.cronRunId)).toBe(true);
          expect(request.job).toEqual(JOB);
        }
      }),
    ));

  test('unchanged synchronization preserves the existing timer', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* TestClock.adjust('30 seconds');
        yield* host.scheduler.sync;
        yield* TestClock.adjust('30 seconds');
        expect(host.requests).toHaveLength(1);
      }),
    ));

  test('long commands overlap and table replacement preserves already running commands', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* Ref.set(host.onRun, Effect.never);
        yield* TestClock.adjust('3 minutes');
        expect(host.requests).toHaveLength(THREE_RUNS);
        expect(yield* Ref.get(host.active)).toBe(THREE_RUNS);
        yield* host.registry.replace({ ...LOG_SOURCE, jobs: [NEXT_JOB] });
        yield* host.scheduler.sync;
        expect(yield* Ref.get(host.active)).toBe(THREE_RUNS);
        yield* Ref.set(host.onRun, Effect.void);
        yield* TestClock.adjust('1 minute');
        expect(host.requests.at(-1)?.job).toEqual(NEXT_JOB);
        expect(yield* Ref.get(host.active)).toBe(THREE_RUNS);
        expect(host.requests[0]?.context.cronJobId).not.toBe(
          host.requests.at(-1)?.context.cronJobId,
        );
      }),
    ));

  test('a replaced registration cannot dispatch while waiting for synchronization', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* TestClock.adjust('30 seconds');
        yield* host.registry.replace({ ...LOG_SOURCE, jobs: [NEXT_JOB] });
        yield* TestClock.adjust('30 seconds');
        expect(host.requests).toEqual([]);
        yield* host.scheduler.sync;
        yield* TestClock.adjust('1 minute');
        expect(host.requests.at(-1)?.job).toEqual(NEXT_JOB);
      }),
    ));

  test('manual suspension removes timers but preserves inspectable registrations', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* host.cache.accept(
          desiredState({ instances: [desiredInstance({ desiredState: 'stopped' })] }),
        );
        yield* host.scheduler.sync;
        yield* TestClock.adjust('10 minutes');
        expect(host.requests).toEqual([]);
        expect((yield* host.registry.get({ appId: APP_ID }))._tag).toBe('Some');
        yield* host.cache.accept(desiredState({ instances: [desiredInstance()] }));
        yield* host.scheduler.sync;
        expect(host.requests).toEqual([]);
        yield* TestClock.adjust('1 minute');
        expect(host.requests).toHaveLength(1);
      }),
    ));

  test('redeployment waits for new registrations instead of retaining old timers', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* host.cache.accept(
          desiredState({ instances: [desiredInstance({ deploymentId: NEXT_DEPLOYMENT })] }),
        );
        yield* host.scheduler.sync;
        yield* TestClock.adjust('10 minutes');
        expect(host.requests).toEqual([]);
        yield* host.registry.beginDeployment({ appId: APP_ID, deploymentId: NEXT_DEPLOYMENT });
        yield* host.registry.replace({
          appId: APP_ID,
          deploymentId: NEXT_DEPLOYMENT,
          jobs: [NEXT_JOB],
        });
        yield* host.scheduler.sync;
        yield* TestClock.adjust('1 minute');
        expect(host.requests[0]?.context.deploymentId).toBe(NEXT_DEPLOYMENT);
      }),
    ));

  test('a command failure is attempted once and the next occurrence still runs', () =>
    run(
      Effect.gen(function* () {
        const host = yield* schedulerHost();
        yield* Ref.set(host.onRun, Effect.fail(new CronExecutionUnavailable()));
        yield* TestClock.adjust('1 minute');
        expect(host.requests).toHaveLength(1);
        yield* TestClock.adjust('30 seconds');
        expect(host.requests).toHaveLength(1);
        yield* TestClock.adjust('30 seconds');
        expect(host.requests).toHaveLength(2);
      }),
    ));

  test('starting timers after elapsed time does not replay previous occurrences', () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.adjust('10 minutes');
        const host = yield* schedulerHost();
        expect(host.requests).toEqual([]);
        yield* TestClock.adjust('1 minute');
        expect(host.requests).toHaveLength(1);
      }),
    ));

  test('duplicate definitions have separate stable job identities', () => {
    const table = { appId: APP_ID, deploymentId: DEPLOYMENT_ID, jobs: [JOB, JOB] };
    const jobs = registeredCronJobs(table);
    expect(jobs[0]?.context.cronJobId).not.toBe(jobs[1]?.context.cronJobId);
    expect(registeredCronJobs(structuredClone(table))).toEqual(jobs);
  });
});
