import { describe, expect, test } from 'bun:test';
import { AppIdSchema, DeploymentIdSchema, GuestPathSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Duration, Effect, Exit, Fiber, TestClock, TestContext } from 'effect';
import { desiredInstance } from '#tests/support/fixtures.ts';
import { sqliteHttpResponse, sqlitePipelineResponse } from '#tests/support/guest-sqlite.ts';
import { platform, provided } from '#tests/support/run.ts';
import { sqliteHost, sqliteQuery } from '#tests/support/sqlite-sessions.ts';

const run = provided(platform);
const OPEN = sqliteQuery({ type: 'open', path: Value.Parse(GuestPathSchema, '/app.db') });
const QUERY = sqliteQuery({
  type: 'pipeline',
  body: {
    baton: null,
    requests: [
      { type: 'execute', stmt: { sql: 'SELECT value', args: [], named_args: [], want_rows: true } },
    ],
  },
});
const CLOSED = sqliteQuery({ type: 'close' });
const NEXT_DEPLOYMENT = Value.Parse(DeploymentIdSchema, 'next-deployment');
const OPEN_RESPONSE = sqliteHttpResponse({});
const PAST_IDLE_TIMEOUT_SECONDS = 31;

describe('deployment-owned SQLite sessions', () => {
  test('rejects requests for another app or deployment without closing the owner session', () =>
    run(
      Effect.gen(function* () {
        const host = yield* sqliteHost([OPEN_RESPONSE, sqlitePipelineResponse()]);
        yield* host.sessions.request(OPEN);
        for (const request of [
          { ...QUERY, appId: Value.Parse(AppIdSchema, 'another-app') },
          { ...QUERY, deploymentId: NEXT_DEPLOYMENT },
        ]) {
          expect((yield* host.sessions.request(request)).status).toBe('failed');
        }
        expect((yield* host.sessions.request(QUERY)).status).toBe('pipelined');
      }),
    ));

  test('closing bypasses a pending query and releases its socket', () =>
    run(
      Effect.gen(function* () {
        const host = yield* sqliteHost([OPEN_RESPONSE]);
        yield* host.sessions.request(OPEN);
        const query = yield* host.sessions.request(QUERY).pipe(Effect.forkScoped);
        yield* Effect.yieldNow();
        expect(yield* host.sessions.request(CLOSED)).toEqual({ status: 'closed' });
        yield* Effect.promise(() => host.guest.closed);
        expect(Exit.isInterrupted(yield* Fiber.await(query))).toBe(true);
      }),
    ));

  test.each(['stopped', 'replaced', 'removed'] as const)(
    '%s deployments close sessions before synchronization returns',
    (change) =>
      run(
        Effect.gen(function* () {
          const host = yield* sqliteHost([OPEN_RESPONSE]);
          yield* host.sessions.request(OPEN);
          const instances =
            change === 'removed'
              ? []
              : [
                  desiredInstance(
                    change === 'stopped'
                      ? { desiredState: 'stopped' }
                      : { deploymentId: NEXT_DEPLOYMENT },
                  ),
                ];
          yield* host.sessions.syncDeployments({ instances });
          yield* Effect.promise(() => host.guest.closed);
          expect((yield* host.sessions.request(QUERY)).status).toBe('failed');
        }),
      ),
  );

  test('unchanged synchronization preserves existing connections', () =>
    run(
      Effect.gen(function* () {
        const host = yield* sqliteHost([OPEN_RESPONSE, sqlitePipelineResponse()]);
        yield* host.sessions.request(OPEN);
        yield* host.sessions.syncDeployments({ instances: [desiredInstance()] });
        expect((yield* host.sessions.request(QUERY)).status).toBe('pipelined');
      }),
    ));

  test('an abandoned session expires and closes its guest connection', () =>
    run(
      Effect.gen(function* () {
        const host = yield* sqliteHost([OPEN_RESPONSE]);
        yield* host.sessions.request(OPEN);
        yield* TestClock.adjust(Duration.seconds(PAST_IDLE_TIMEOUT_SECONDS));
        yield* Effect.promise(() => host.guest.closed);
        expect((yield* host.sessions.request(QUERY)).status).toBe('failed');
      }).pipe(Effect.provide(TestContext.TestContext)),
    ));

  test('query activity resets expiry from the most recent request', () =>
    run(
      Effect.gen(function* () {
        const host = yield* sqliteHost([
          OPEN_RESPONSE,
          sqlitePipelineResponse(),
          sqlitePipelineResponse(),
        ]);
        yield* host.sessions.request(OPEN);
        yield* TestClock.adjust('20 seconds');
        expect((yield* host.sessions.request(QUERY)).status).toBe('pipelined');
        yield* TestClock.adjust('20 seconds');
        expect((yield* host.sessions.request(QUERY)).status).toBe('pipelined');
        yield* TestClock.adjust(Duration.seconds(PAST_IDLE_TIMEOUT_SECONDS));
        yield* Effect.promise(() => host.guest.closed);
        expect((yield* host.sessions.request(QUERY)).status).toBe('failed');
      }).pipe(Effect.provide(TestContext.TestContext)),
    ));
});
