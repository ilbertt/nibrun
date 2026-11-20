import { expect, test } from 'bun:test';
import { Cause, Deferred, Effect, Fiber, Schedule } from 'effect';
import { supervised } from '#lib/agent/loop.ts';
import { runScoped } from '#tests/support/run.ts';

test('stopping a supervised loop does not report a failure', async () => {
  await runScoped(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const failures: Cause.Cause<unknown>[] = [];
      const fiber = yield* Effect.forkScoped(
        supervised({
          once: Effect.andThen(Deferred.succeed(started, undefined), Effect.never),
          onFailure: (cause) => Effect.sync(() => failures.push(cause)),
          schedule: Schedule.stop,
        }),
      );
      yield* Deferred.await(started);
      const exit = yield* Fiber.interrupt(fiber);
      expect(exit._tag).toBe('Failure');
      expect(failures).toEqual([]);
    }),
  );
});

test('a supervised loop reports both expected errors and defects', async () => {
  for (const { once, message } of [
    { once: Effect.fail('unavailable'), message: 'unavailable' },
    { once: Effect.die('broken'), message: 'broken' },
  ]) {
    await runScoped(
      Effect.gen(function* () {
        const failures: Cause.Cause<string>[] = [];
        yield* Effect.exit(
          supervised({
            once,
            onFailure: (cause) => Effect.sync(() => failures.push(cause)),
            schedule: Schedule.stop,
          }),
        );
        expect(failures).toHaveLength(1);
        expect(failures.map((cause) => Cause.pretty(cause))).toEqual([
          expect.stringContaining(message),
        ]);
      }),
    );
  }
});
