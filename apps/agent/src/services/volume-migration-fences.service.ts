import type { AppId } from '@repo/protocol';
import { Deferred, Effect, Either, Option, Ref } from 'effect';
import { VolumeMigrationFenceBusy } from '#lib/volumes/volume-migration-fence.ts';
import { AgentState } from '#services/agent-state.service.ts';

type Entry = {
  readonly active: number;
  readonly held: boolean;
  readonly drained: Deferred.Deferred<void>;
};

/** Close lifecycle admission before draining GuestActivity: admitted guest work may still need to wake its VM. */
export class VolumeMigrationFences extends Effect.Service<VolumeMigrationFences>()(
  'VolumeMigrationFences',
  {
    effect: Effect.gen(function* () {
      const state = yield* AgentState;
      const entries = yield* Ref.make<ReadonlyMap<AppId, Entry>>(new Map());

      function admit(appIds: Iterable<AppId>) {
        return Effect.gen(function* () {
          const fresh = yield* Effect.forEach(new Set(appIds), (appId) =>
            Effect.map(Deferred.make<void>(), (drained) => ({ appId, drained })),
          );
          return yield* Ref.modify(entries, (current) => {
            const next = new Map(current);
            const blocked = new Set(
              [...current].filter(([, entry]) => entry.held).map(([appId]) => appId),
            );
            const admitted: AppId[] = [];
            for (const { appId, drained } of fresh) {
              const entry = next.get(appId) ?? { active: 0, held: false, drained };
              if (!entry.held) {
                next.set(appId, { ...entry, active: entry.active + 1 });
                admitted.push(appId);
              }
            }
            return [{ admitted, blocked }, next];
          });
        });
      }

      function finishEntry({ next, appId }: { next: Map<AppId, Entry>; appId: AppId }) {
        const entry = next.get(appId);
        if (!entry) {
          return undefined;
        }
        if (entry.active > 1) {
          next.set(appId, { ...entry, active: entry.active - 1 });
          return undefined;
        }
        if (entry.held) {
          next.set(appId, { ...entry, active: 0 });
        } else {
          next.delete(appId);
        }
        return entry.drained;
      }

      function finish(appIds: readonly AppId[]) {
        return Effect.flatMap(
          Ref.modify(entries, (current) => {
            const next = new Map(current);
            const drained: Deferred.Deferred<void>[] = [];
            for (const appId of appIds) {
              const signal = finishEntry({ next, appId });
              if (signal) {
                drained.push(signal);
              }
            }
            return [drained, next];
          }),
          (drained) =>
            Effect.forEach(drained, (signal) => Deferred.succeed(signal, undefined), {
              discard: true,
            }),
        );
      }

      function access<A, E, R>({
        appIds,
        use,
      }: {
        appIds: Iterable<AppId>;
        use: (blocked: ReadonlySet<AppId>) => Effect.Effect<A, E, R>;
      }) {
        return Effect.acquireUseRelease(
          admit(appIds),
          ({ blocked }) => use(blocked),
          ({ admitted }) => finish(admitted),
        );
      }

      function acquire(appId: AppId) {
        return Effect.gen(function* () {
          const drained = yield* Deferred.make<void>();
          const claim = yield* Ref.modify(
            entries,
            (
              current,
            ): readonly [
              Either.Either<Option.Option<Deferred.Deferred<void>>, VolumeMigrationFenceBusy>,
              ReadonlyMap<AppId, Entry>,
            ] => {
              const entry = current.get(appId) ?? { active: 0, held: false, drained };
              return entry.held
                ? ([Either.left(new VolumeMigrationFenceBusy()), current] as const)
                : ([
                    Either.right(entry.active > 0 ? Option.some(entry.drained) : Option.none()),
                    new Map(current).set(appId, { ...entry, held: true }),
                  ] as const);
            },
          );
          return yield* claim;
        });
      }

      function release(appId: AppId) {
        return Ref.update(entries, (current) => {
          const next = new Map(current);
          const entry = next.get(appId);
          if (entry?.active === 0) {
            next.delete(appId);
          } else if (entry) {
            next.set(appId, { ...entry, held: false });
          }
          return next;
        }).pipe(Effect.andThen(state.modify((current) => ({ ...current, deferredWork: true }))));
      }

      /** Acquire before draining guest activity, and outside any access scope for this app. */
      function during<A, E, R>({
        appId,
        effect,
      }: {
        appId: AppId;
        effect: Effect.Effect<A, E, R>;
      }) {
        return Effect.acquireUseRelease(
          acquire(appId),
          (drained) =>
            (Option.isSome(drained) ? Deferred.await(drained.value) : Effect.void).pipe(
              Effect.andThen(effect),
            ),
          () => release(appId),
        );
      }

      return { access, during };
    }),
    dependencies: [AgentState.Default],
  },
) {}
