import { expect, test } from 'bun:test';
import { Effect, Either, Fiber, Layer, TestClock, TestContext } from 'effect';
import { waitForApp } from '#lib/proxy/readiness.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { APP_ID, instanceRecord } from '#tests/support/fixtures.ts';
import { provided } from '#tests/support/run.ts';

const run = provided(Layer.mergeAll(AgentState.Default, TestContext.TestContext));

test('a startup that never completes cannot hold a request forever', () =>
  run(
    Effect.gen(function* () {
      yield* AgentState.putRecord(instanceRecord({ state: 'starting' }));
      const waiting = yield* Effect.fork(Effect.either(waitForApp(APP_ID)));
      yield* TestClock.adjust('60 seconds');
      const result = yield* Fiber.join(waiting);
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe('AppStartTimedOut');
      }
    }),
  ));

test('suspending an app releases a request that was waiting for startup', () =>
  run(
    Effect.gen(function* () {
      yield* AgentState.putRecord(instanceRecord({ state: 'starting' }));
      const waiting = yield* Effect.fork(waitForApp(APP_ID));
      yield* TestClock.adjust('250 millis');
      yield* AgentState.putRecord(instanceRecord({ state: 'stopped', desiredRunning: false }));
      yield* TestClock.adjust('250 millis');
      expect((yield* Fiber.join(waiting))?.desiredRunning).toBe(false);
    }),
  ));
