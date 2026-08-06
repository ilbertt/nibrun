import { describe, expect, test } from 'bun:test';
import type { HostDesiredState } from '@repo/protocol';
import { Effect, Layer } from 'effect';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { desiredInstance, desiredState } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

/** Gives each state to a fresh cache in turn, and reports what it made of each. */
function accepting(states: readonly HostDesiredState[]): Promise<boolean[]> {
  return provided(platform)(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      return yield* Effect.gen(function* () {
        const cache = yield* DesiredStateCache;
        return yield* Effect.forEach(states, (state) => cache.accept(state));
      }).pipe(
        Effect.provide(
          DesiredStateCache.DefaultWithoutDependencies.pipe(
            Layer.provide(agentConfig({ desiredStateFile: `${directory}/desired-state.json` })),
          ),
        ),
      );
    }),
  );
}

/**
 * The control plane sends the whole of desired state every poll and says nothing about whether it
 * moved — deciding that would cost it a read of everything it was trying not to send. So this is
 * the only thing standing between a poll and a reconcile.
 */
describe('a host compares what arrives with what it holds', () => {
  test('the first state a host is ever given is news', async () => {
    expect(await accepting([desiredState()])).toEqual([true]);
  });

  // A host polls every second and the fleet changes far less often, so this is the answer almost
  // every poll gets, and the one that must not start a reconcile.
  test('the same state again is not', async () => {
    const state = desiredState({ instances: [desiredInstance()] });

    expect(await accepting([state, { ...state }])).toEqual([true, false]);
  });

  // Compared by value rather than by identity: every poll parses a fresh object, so nothing that
  // arrives is ever the one already held.
  test('a change buried inside an instance is news', async () => {
    const running = desiredInstance({ desiredState: 'running' });
    const stopped = { ...running, desiredState: 'stopped' } satisfies typeof running;

    expect(
      await accepting([
        desiredState({ instances: [running] }),
        desiredState({ instances: [stopped] }),
      ]),
    ).toEqual([true, true]);
  });

  test('and so is one going away', async () => {
    expect(
      await accepting([desiredState({ instances: [desiredInstance()] }), desiredState()]),
    ).toEqual([true, true]);
  });
});
