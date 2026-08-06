import { type HostDesiredState, HostDesiredStateSchema, parseMessage } from '@repo/protocol';
import { Effect, Option, Ref } from 'effect';
import { readJsonFile, writeJsonFile } from '#lib/json-store.ts';
import { decode } from '#lib/protocol.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

/**
 * The last desired state this host was given, kept on disk so an agent restart during a
 * control-plane outage is a non-event: the host still knows what it is supposed to be running.
 *
 * Holding it is also what decides whether a poll is news. The control plane sends the whole of
 * it every time and says nothing about whether it moved — it would have to read all of it to
 * know, which is the work it would be saving — so the comparison lives here, with the only party
 * that knows what it converged on.
 */
export class DesiredStateCache extends Effect.Service<DesiredStateCache>()('DesiredStateCache', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const latest = yield* Ref.make(Option.none<HostDesiredState>());

    const remember = (state: HostDesiredState) => Ref.set(latest, Option.some(state));

    return {
      latest: Ref.get(latest),

      /** Whether this differs from what the host holds, and so whether it is worth converging on. */
      accept: Effect.fn('DesiredStateCache.accept')(function* (state: HostDesiredState) {
        const held = yield* Ref.get(latest);
        if (Option.isSome(held) && Bun.deepEquals(held.value, state)) {
          return false;
        }
        yield* writeJsonFile({ path: config.desiredStateFile, value: state });
        yield* remember(state);
        return true;
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
