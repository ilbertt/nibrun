import { describe, expect, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Clock, Deferred, Effect, Fiber, Layer, Ref, TestClock, TestContext } from 'effect';
import { AgentState } from '#services/agent-state.service.ts';
import { GuestActivity } from '#services/guest-activity.service.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { provided } from '#tests/support/run.ts';

const run = provided(
  Layer.mergeAll(GuestActivity.Default, AgentState.Default, TestContext.TestContext),
);
const OTHER_APP = Value.Parse(AppIdSchema, 'other-app');

function heldRun(activity: GuestActivity) {
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
        const activity = yield* GuestActivity;
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
        const activity = yield* GuestActivity;
        yield* heldRun(activity);
        const slept = yield* Ref.make(false);
        yield* activity.whenIdle({ appId: OTHER_APP, effect: Ref.set(slept, true) });
        expect(yield* Ref.get(slept)).toBe(true);
      }),
    ));

  test('a run arriving during capture waits until capture has finished', () =>
    run(
      Effect.gen(function* () {
        const activity = yield* GuestActivity;
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
        const activity = yield* GuestActivity;
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
        const activity = yield* GuestActivity;
        expect(
          yield* activity.run({ appId: APP_ID, effect: Effect.fail('failed') }).pipe(Effect.flip),
        ).toBe('failed');
        const slept = yield* Ref.make(false);
        yield* activity.whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) });
        expect(yield* Ref.get(slept)).toBe(true);
      }),
    ));
});

test('exclusive activity drains existing work and blocks new work only for its app', () =>
  run(
    Effect.gen(function* () {
      const activity = yield* GuestActivity;
      const first = yield* heldRun(activity);
      const second = yield* heldRun(activity);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const exclusive = yield* activity
        .exclusively({
          appId: APP_ID,
          effect: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow();
      const waiting = yield* Deferred.make<void>();
      const later = yield* activity
        .run({ appId: APP_ID, effect: Deferred.succeed(waiting, undefined) })
        .pipe(Effect.forkScoped);
      yield* activity.run({ appId: OTHER_APP, effect: Effect.void });
      expect(yield* Deferred.isDone(entered)).toBe(false);
      yield* first.finish;
      expect(yield* Deferred.isDone(entered)).toBe(false);
      yield* second.finish;
      yield* Deferred.await(entered);
      expect(yield* Deferred.isDone(waiting)).toBe(false);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(exclusive);
      yield* Fiber.join(later);
      expect(yield* Deferred.isDone(waiting)).toBe(true);
    }),
  ));

test('cancelling an exclusive drain releases admission without cancelling existing work', () =>
  run(
    Effect.gen(function* () {
      const activity = yield* GuestActivity;
      const current = yield* heldRun(activity);
      const entered = yield* Ref.make(false);
      const exclusive = yield* activity
        .exclusively({ appId: APP_ID, effect: Ref.set(entered, true) })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow();
      yield* Fiber.interrupt(exclusive);
      expect(yield* Ref.get(entered)).toBe(false);
      expect((yield* Fiber.poll(current.fiber))._tag).toBe('None');
      yield* activity.run({ appId: APP_ID, effect: Effect.void });
      yield* current.finish;
      expect(yield* activity.exclusively({ appId: APP_ID, effect: Effect.succeed('next') })).toBe(
        'next',
      );
    }),
  ));

test('failed or interrupted exclusive work releases its gate and preserves the outcome', () =>
  run(
    Effect.gen(function* () {
      const activity = yield* GuestActivity;
      expect(
        yield* activity
          .exclusively({ appId: APP_ID, effect: Effect.fail('copy failed') })
          .pipe(Effect.flip),
      ).toBe('copy failed');
      const entered = yield* Deferred.make<void>();
      const exclusive = yield* activity
        .exclusively({
          appId: APP_ID,
          effect: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(exclusive);
      yield* activity.run({ appId: APP_ID, effect: Effect.void });
      expect(yield* activity.exclusively({ appId: APP_ID, effect: Effect.succeed('next') })).toBe(
        'next',
      );
    }),
  ));

test('a later drain waits for the next activity generation and cancellation of its last run', () =>
  run(
    Effect.gen(function* () {
      const activity = yield* GuestActivity;
      const earlier = yield* heldRun(activity);
      const holding = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const firstDrain = yield* activity
        .exclusively({
          appId: APP_ID,
          effect: Deferred.succeed(holding, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow();
      const started = yield* Deferred.make<void>();
      const current = yield* activity
        .run({
          appId: APP_ID,
          effect: Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow();
      yield* earlier.finish;
      yield* Deferred.await(holding);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(firstDrain);
      yield* Deferred.await(started);
      const entered = yield* Deferred.make<void>();
      const exclusive = yield* activity
        .exclusively({ appId: APP_ID, effect: Deferred.succeed(entered, undefined) })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow();
      expect(yield* Deferred.isDone(entered)).toBe(false);
      yield* Fiber.interrupt(current);
      yield* Fiber.join(exclusive);
      expect(yield* Deferred.isDone(entered)).toBe(true);
    }),
  ));
