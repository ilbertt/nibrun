import { describe, expect, test } from 'bun:test';
import { AppIdSchema, Value } from '@repo/protocol';
import { Clock, Deferred, Effect, Fiber, Layer, Ref, TestClock, TestContext } from 'effect';
import { AgentState } from '#services/agent-state.service.ts';
import { CronActivity } from '#services/cron-activity.service.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { provided } from '#tests/support/run.ts';

const run = provided(
  Layer.mergeAll(CronActivity.Default, AgentState.Default, TestContext.TestContext),
);
const OTHER_APP = Value.Parse(AppIdSchema, 'other-app');

function heldRun(activity: CronActivity) {
  return Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const fiber = yield* activity
      .run({
        appId: APP_ID,
        effect: Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
      })
      .pipe(Effect.forkScoped);
    yield* Deferred.await(started);
    return {
      fiber,
      finish: Deferred.succeed(release, undefined).pipe(Effect.andThen(Fiber.join(fiber))),
    };
  });
}

describe('cron idle protection', () => {
  test('every overlapping run keeps its app awake until the last one finishes', () =>
    run(
      Effect.gen(function* () {
        const activity = yield* CronActivity;
        const slept = yield* Ref.make(0);
        const sleep = activity.whenIdle({
          appId: APP_ID,
          effect: Ref.update(slept, (count) => count + 1),
        });
        const first = yield* heldRun(activity);
        const second = yield* heldRun(activity);
        yield* sleep;
        yield* first.finish;
        yield* sleep;
        expect(yield* Ref.get(slept)).toBe(0);
        yield* second.finish;
        yield* sleep;
        expect(yield* Ref.get(slept)).toBe(1);
      }),
    ));

  test('a run does not prevent another app from sleeping', () =>
    run(
      Effect.gen(function* () {
        const activity = yield* CronActivity;
        yield* heldRun(activity);
        const slept = yield* Ref.make(false);
        yield* activity.whenIdle({ appId: OTHER_APP, effect: Ref.set(slept, true) });
        expect(yield* Ref.get(slept)).toBe(true);
      }),
    ));

  test('a run arriving during capture waits until capture has finished', () =>
    run(
      Effect.gen(function* () {
        const activity = yield* CronActivity;
        const capturing = yield* Deferred.make<void>();
        const captured = yield* Deferred.make<void>();
        const started = yield* Ref.make(false);
        const sleeping = yield* activity
          .whenIdle({
            appId: APP_ID,
            effect: Deferred.succeed(capturing, undefined).pipe(
              Effect.andThen(Deferred.await(captured)),
            ),
          })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(capturing);
        const execution = yield* activity
          .run({ appId: APP_ID, effect: Ref.set(started, true) })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow();
        expect(yield* Ref.get(started)).toBe(false);
        yield* Deferred.succeed(captured, undefined);
        yield* Fiber.join(sleeping);
        yield* Fiber.join(execution);
        expect(yield* Ref.get(started)).toBe(true);
      }),
    ));

  test('cancellation releases protection and restarts the idle interval', () =>
    run(
      Effect.gen(function* () {
        const activity = yield* CronActivity;
        const execution = yield* heldRun(activity);
        yield* TestClock.adjust('10 minutes');
        const now = yield* Clock.currentTimeMillis;
        yield* Fiber.interrupt(execution.fiber);
        expect((yield* AgentState.snapshot).lastActiveAtMs.get(APP_ID)).toBe(now);
        const slept = yield* Ref.make(false);
        yield* activity.whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) });
        expect(yield* Ref.get(slept)).toBe(true);
      }),
    ));

  test('a failed run releases protection and preserves its error', () =>
    run(
      Effect.gen(function* () {
        const activity = yield* CronActivity;
        expect(
          yield* activity.run({ appId: APP_ID, effect: Effect.fail('failed') }).pipe(Effect.flip),
        ).toBe('failed');
        const slept = yield* Ref.make(false);
        yield* activity.whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) });
        expect(yield* Ref.get(slept)).toBe(true);
      }),
    ));

  test('a wake waits for its image upgrade while another app can wake', () =>
    run(
      Effect.gen(function* () {
        const activity = yield* CronActivity;
        const upgrading = yield* Deferred.make<void>();
        const upgraded = yield* Deferred.make<void>();
        const woke = yield* Ref.make(false);
        const upgrade = yield* activity
          .whenIdle({
            appId: APP_ID,
            effect: Deferred.succeed(upgrading, undefined).pipe(
              Effect.andThen(Deferred.await(upgraded)),
            ),
          })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(upgrading);
        const wake = yield* activity
          .exclusive({ appId: APP_ID, effect: Ref.set(woke, true) })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow();
        expect(yield* Ref.get(woke)).toBe(false);
        expect(
          yield* activity.exclusive({ appId: OTHER_APP, effect: Effect.succeed('awake') }),
        ).toBe('awake');
        yield* Deferred.succeed(upgraded, undefined);
        yield* Fiber.join(upgrade);
        yield* Fiber.join(wake);
        expect(yield* Ref.get(woke)).toBe(true);
      }),
    ));

  test('a cron run can acquire the wake gate without releasing its run protection', () =>
    run(
      Effect.gen(function* () {
        const activity = yield* CronActivity;
        const upgraded = yield* Ref.make(false);
        yield* activity.run({
          appId: APP_ID,
          effect: activity.exclusive({
            appId: APP_ID,
            effect: Effect.succeed('awake'),
          }),
        });
        yield* activity.whenIdle({ appId: APP_ID, effect: Ref.set(upgraded, true) });
        expect(yield* Ref.get(upgraded)).toBe(true);
      }),
    ));
});
