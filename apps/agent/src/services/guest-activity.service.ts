import type { AppId } from '@repo/protocol';
import { Clock, Deferred, Effect, Option, Ref } from 'effect';
import { AgentState } from '#services/agent-state.service.ts';

type Activity = {
  readonly gate: Effect.Semaphore;
  readonly running: Ref.Ref<{ readonly count: number; readonly drained: Deferred.Deferred<void> }>;
  readonly users: number;
};

export class GuestActivity extends Effect.Service<GuestActivity>()('GuestActivity', {
  effect: Effect.gen(function* () {
    const state = yield* AgentState;
    const activities = yield* Ref.make(new Map<AppId, Activity>());

    function acquire(appId: AppId) {
      return Effect.gen(function* () {
        const gate = yield* Effect.makeSemaphore(1);
        const running = yield* Ref.make({ count: 0, drained: yield* Deferred.make<void>() });
        return yield* Ref.modify(activities, (current) => {
          const activity = current.get(appId) ?? { gate, running, users: 0 };
          return [
            activity,
            new Map(current).set(appId, { ...activity, users: activity.users + 1 }),
          ];
        });
      });
    }

    function release(appId: AppId) {
      return Ref.update(activities, (current) => {
        const next = new Map(current);
        const activity = next.get(appId);
        if (activity?.users === 1) {
          next.delete(appId);
        } else if (activity) {
          next.set(appId, { ...activity, users: activity.users - 1 });
        }
        return next;
      });
    }

    function withActivity<A, E, R>({
      appId,
      use,
    }: {
      appId: AppId;
      use: (activity: Activity) => Effect.Effect<A, E, R>;
    }) {
      return Effect.acquireUseRelease(acquire(appId), use, () => release(appId));
    }

    function run<A, E, R>({ appId, effect }: { appId: AppId; effect: Effect.Effect<A, E, R> }) {
      return withActivity({
        appId,
        use: (activity) =>
          Effect.scoped(
            activity.gate
              .withPermits(1)(
                Effect.acquireRelease(
                  Effect.flatMap(Deferred.make<void>(), (drained) =>
                    Ref.update(activity.running, (current) => ({
                      count: current.count + 1,
                      drained: current.count === 0 ? drained : current.drained,
                    })),
                  ),
                  () =>
                    Effect.gen(function* () {
                      yield* state.markActive({ appId, nowMs: yield* Clock.currentTimeMillis });
                      const drained = yield* Ref.modify(activity.running, (current) => [
                        current.count === 1 ? Option.some(current.drained) : Option.none(),
                        { ...current, count: current.count - 1 },
                      ]);
                      if (Option.isSome(drained)) {
                        yield* Deferred.succeed(drained.value, undefined);
                      }
                    }),
                ),
              )
              .pipe(Effect.andThen(effect)),
          ),
      });
    }

    function whenIdle<E, R>({
      appId,
      effect,
    }: {
      appId: AppId;
      effect: Effect.Effect<unknown, E, R>;
    }) {
      return withActivity({
        appId,
        use: (activity) =>
          activity.gate.withPermits(1)(
            Effect.flatMap(Ref.get(activity.running), ({ count }) =>
              count === 0 ? Effect.asVoid(effect) : Effect.void,
            ),
          ),
      });
    }

    /** Calling inside this app's run scope deadlocks its drain. Wakes and reconciliation need separate fencing. */
    function exclusively<A, E, R>({
      appId,
      effect,
    }: {
      appId: AppId;
      effect: Effect.Effect<A, E, R>;
    }) {
      return withActivity({
        appId,
        use: (activity) =>
          activity.gate.withPermits(1)(
            Effect.gen(function* () {
              const current = yield* Ref.get(activity.running);
              if (current.count > 0) {
                yield* Deferred.await(current.drained);
              }
              return yield* effect;
            }),
          ),
      });
    }

    return { run, whenIdle, exclusively };
  }),
  dependencies: [AgentState.Default],
}) {}
