import type { AppId } from '@repo/protocol';
import { Clock, Effect, Ref } from 'effect';
import { AgentState } from '#services/agent-state.service.ts';

type Activity = {
  readonly gate: Effect.Semaphore;
  readonly running: Ref.Ref<number>;
  readonly users: number;
};

export class GuestActivity extends Effect.Service<GuestActivity>()('GuestActivity', {
  effect: Effect.gen(function* () {
    const state = yield* AgentState;
    const activities = yield* Ref.make(new Map<AppId, Activity>());

    function acquire(appId: AppId) {
      return Effect.gen(function* () {
        const gate = yield* Effect.makeSemaphore(1);
        const running = yield* Ref.make(0);
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
                  Ref.update(activity.running, (count) => count + 1),
                  () =>
                    Effect.gen(function* () {
                      yield* state.markActive({ appId, nowMs: yield* Clock.currentTimeMillis });
                      yield* Ref.update(activity.running, (count) => count - 1);
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
            Effect.flatMap(Ref.get(activity.running), (count) =>
              count === 0 ? Effect.asVoid(effect) : Effect.void,
            ),
          ),
      });
    }

    return { run, whenIdle };
  }),
  dependencies: [AgentState.Default],
}) {}
