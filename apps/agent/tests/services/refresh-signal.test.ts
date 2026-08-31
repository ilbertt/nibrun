import { describe, expect, test } from 'bun:test';
import { Duration, Effect, Fiber } from 'effect';
import { RefreshSignal } from '#services/refresh-signal.service.ts';

const A_TICK = Duration.seconds(1);

function withSignal<A>(body: Effect.Effect<A, never, RefreshSignal>): Promise<A> {
  return Effect.runPromise(body.pipe(Effect.provide(RefreshSignal.Default)));
}

/**
 * The status loop races its sleep against this, so what is being pinned here is that a raise ends
 * that sleep however the two are ordered — the wake that raises it and the refresh that reads it
 * run on different fibers, and nothing sequences them.
 */
describe('a raise ends the wait it was raised for', () => {
  test('a waiter already holding is released by a raise', async () => {
    const waited = await withSignal(
      Effect.gen(function* () {
        const waiting = yield* Effect.fork(
          Effect.race(
            Effect.sleep(A_TICK).pipe(Effect.as('slept')),
            RefreshSignal.awaited.pipe(Effect.as('raised')),
          ),
        );
        yield* RefreshSignal.raise;
        return yield* Fiber.join(waiting);
      }),
    );

    expect(waited).toBe('raised');
  });

  /**
   * The case a handoff would lose. A wake that lands while the loop is mid-refresh has nobody
   * waiting on it, and dropping it would leave the app it just brought up unforwarded until the
   * tick it was raised to pre-empt.
   */
  test('a raise with nobody waiting is kept for the next one', async () => {
    const waited = await withSignal(
      Effect.gen(function* () {
        yield* RefreshSignal.raise;
        return yield* Effect.race(
          Effect.sleep(A_TICK).pipe(Effect.as('slept')),
          RefreshSignal.awaited.pipe(Effect.as('raised')),
        );
      }),
    );

    expect(waited).toBe('raised');
  });

  // Sliding and one deep: a raise says something moved, and a second one before anything read the
  // first says nothing more. The refresh it wakes reads the whole of the state either way.
  test('two raises are one refresh, not two', async () => {
    const second = await withSignal(
      Effect.gen(function* () {
        yield* RefreshSignal.raise;
        yield* RefreshSignal.raise;
        yield* RefreshSignal.awaited;
        return yield* Effect.race(
          Effect.sleep(Duration.millis(50)).pipe(Effect.as('slept')),
          RefreshSignal.awaited.pipe(Effect.as('raised')),
        );
      }),
    );

    expect(second).toBe('slept');
  });
});
