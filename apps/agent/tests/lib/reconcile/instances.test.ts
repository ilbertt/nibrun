import { describe, expect, test } from 'bun:test';
import { FetchHttpClient } from '@effect/platform';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { refreshStates } from '#lib/reconcile/instances.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { ReportSignal } from '#services/report-signal.service.ts';
import { succeeding } from '#tests/support/commands.ts';
import { APP_ID, instanceRecord } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';

/** What `systemctl show` says about a microVM that is up, which is all a pass reads off it. */
const ACTIVE_UNIT = [
  'LoadState=loaded',
  'ActiveState=active',
  'SubState=running',
  'Result=success',
  'ExecMainStatus=0',
  'InactiveExitTimestampMonotonic=1',
].join('\n');

/** Far enough out that no instance is due, so a pass turns on the unit alone and never probes. */
const NEVER_DUE = Number.MAX_SAFE_INTEGER;

const run = provided(
  Layer.mergeAll(AgentState.Default, ReportSignal.Default, FetchHttpClient.layer).pipe(
    Layer.provideMerge(platform),
  ),
);

/**
 * A pass held open at the one call it makes before it writes, which is where a reconcile lands in
 * production: the pass has read the record and has yet to say anything about it.
 */
function passHeldOpen() {
  return Effect.gen(function* () {
    const reading = yield* Deferred.make<void>();
    const held = yield* Deferred.make<void>();
    const commands = Layer.succeed(
      CommandRunner,
      CommandRunner.make({
        run: () =>
          Deferred.succeed(reading, undefined).pipe(
            Effect.andThen(Deferred.await(held)),
            Effect.andThen(succeeding({ stdout: ACTIVE_UNIT })),
          ),
      }),
    );
    const pass = yield* Effect.fork(refreshStates.pipe(Effect.provide(commands)));
    yield* Deferred.await(reading);
    return {
      finish: Deferred.succeed(held, undefined).pipe(Effect.andThen(Fiber.join(pass))),
    };
  });
}

const recordOf = Effect.map(AgentState.snapshot, (current) => current.records.get(APP_ID));

describe('a settle writes back only what it measured', () => {
  test('a start that lands mid-pass keeps the stop it cleared', () =>
    run(
      Effect.gen(function* () {
        yield* AgentState.putRecord(
          instanceRecord({ state: 'stopped', stopRequested: true, desiredRunning: true }),
        );
        yield* AgentState.modify((current) => ({
          ...current,
          nextProbeAtMs: new Map([[APP_ID, NEVER_DUE]]),
        }));

        const pass = yield* passHeldOpen();
        // Exactly what `startInstance` writes once the boot it was waiting on comes up.
        yield* AgentState.updateRecord({
          appId: APP_ID,
          change: (record) => ({ ...record, state: 'starting', stopRequested: false }),
        });
        yield* pass.finish;

        // Were this put back, the instance would read `stopping` for as long as its unit stayed
        // up: never forwarded, and never started again, because the planner lets it be.
        expect((yield* recordOf)?.stopRequested).toBe(false);
      }),
    ));

  test('an instance dropped mid-pass is not brought back', () =>
    run(
      Effect.gen(function* () {
        yield* AgentState.putRecord(instanceRecord({ state: 'running' }));
        yield* AgentState.modify((current) => ({
          ...current,
          nextProbeAtMs: new Map([[APP_ID, NEVER_DUE]]),
        }));

        const pass = yield* passHeldOpen();
        yield* AgentState.dropRecord(APP_ID);
        yield* pass.finish;

        expect(yield* recordOf).toBeUndefined();
      }),
    ));
});
