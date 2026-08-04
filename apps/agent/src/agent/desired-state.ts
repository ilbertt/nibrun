import { type HostDesiredState, HostDesiredStateSchema, parseMessage } from '@repo/protocol';
import { Effect, Option, Ref } from 'effect';
import { AgentConfig } from '#config.ts';
import { readJsonFile, writeJsonFile } from '#lib/json-store.ts';
import { decode } from '#lib/protocol.ts';

const FIRST_GENERATION = 0;

/**
 * The last desired state this host was given, kept on disk so an agent restart during a
 * control-plane outage is a non-event: the host still knows what it is supposed to be running.
 */
export class DesiredStateCache extends Effect.Service<DesiredStateCache>()('DesiredStateCache', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const generation = yield* Ref.make(FIRST_GENERATION);
    const latest = yield* Ref.make(Option.none<HostDesiredState>());

    const remember = (state: HostDesiredState) =>
      Ref.set(generation, state.generation).pipe(
        Effect.andThen(Ref.set(latest, Option.some(state))),
      );

    return {
      knownGeneration: Ref.get(generation),
      latest: Ref.get(latest),

      accept: Effect.fn('DesiredStateCache.accept')(function* (state: HostDesiredState) {
        yield* Effect.annotateCurrentSpan({ generation: state.generation });
        yield* writeJsonFile({ path: config.desiredStateFile, value: state });
        yield* remember(state);
      }),

      restore: Effect.gen(function* () {
        const value = yield* readJsonFile(config.desiredStateFile).pipe(
          Effect.orElseSucceed(() => Option.none<unknown>()),
        );
        if (Option.isNone(value)) {
          return Option.none<HostDesiredState>();
        }
        const state = yield* decode(() =>
          parseMessage({ schema: HostDesiredStateSchema, value: value.value }),
        ).pipe(
          Effect.map(Option.some),
          Effect.catchAll((error) =>
            Effect.logWarning('cached desired state discarded', error).pipe(
              Effect.as(Option.none<HostDesiredState>()),
            ),
          ),
        );
        if (Option.isSome(state)) {
          yield* remember(state.value);
        }
        return state;
      }),
    };
  }),
  dependencies: [AgentConfig.Default],
}) {}
