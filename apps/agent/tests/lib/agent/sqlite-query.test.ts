import { describe, expect, test } from 'bun:test';
import {
  AgentSessionSchema,
  DEFAULT_AGENT_POLL_SETTINGS,
  HostVersionsSchema,
  type SqliteOutcome,
  type SqliteQuery,
  type SqliteQueryRequest,
  type SqliteQueryResult,
  Value,
} from '@repo/protocol';
import { Deferred, Effect, Fiber, Layer, Option, Ref, TestClock, TestContext } from 'effect';
import { MAX_ACTIVE_SQLITE_QUERIES, sqliteQueryLoop } from '#lib/agent/sqlite-query.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { SqliteSessions } from '#services/sqlite-sessions.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { desiredInstance, desiredState, HOST_ID, LOG_SOURCE } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';
import { sqliteQuery } from '#tests/support/sqlite-sessions.ts';

const run = provided(Layer.mergeAll(platform, TestContext.TestContext, agentConfig()));
const SESSION = Value.Parse(AgentSessionSchema, {
  hostId: HOST_ID,
  sessionToken: 'session-token',
  expiresAt: '2026-10-01T20:00:00Z',
  poll: DEFAULT_AGENT_POLL_SETTINGS,
});
const VERSIONS = Value.Parse(HostVersionsSchema, {
  agent: 'a',
  guestImage: 'b',
  zerofs: 'c',
  firecracker: 'd',
});
const QUERY = sqliteQuery({ type: 'sequence', sql: 'BEGIN' });
const CLOSE = sqliteQuery({ type: 'close' });
const POLLS_ACROSS_TWO_FLOORS = 3;

function unreached() {
  return Effect.dieMessage('SQLite queries use only their query and result routes');
}

function loopHost({
  queued,
  execute,
  send,
}: {
  queued: SqliteQuery[];
  execute: (query: SqliteQuery) => Effect.Effect<SqliteOutcome>;
  send: Effect.Effect<void>;
}) {
  return Effect.gen(function* () {
    const polls: SqliteQueryRequest[] = [];
    const answers: SqliteQueryResult[] = [];
    const invoked: SqliteQuery[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(
        ControlPlane,
        ControlPlane.make({
          openSession: unreached,
          fetchDesiredState: unreached,
          sendReportedState: unreached,
          fetchFilesystemQuery: unreached,
          sendFilesystemQueryResult: unreached,
          fetchCronQuery: unreached,
          sendCronQueryResult: unreached,
          fetchSqliteQuery: ({ request }) =>
            Effect.sync(() => {
              polls.push(request);
              const query = queued.shift();
              return query ? { result: 'query' as const, query } : { result: 'none' as const };
            }),
          sendSqliteQueryResult: ({ result }) =>
            send.pipe(
              Effect.andThen(
                Effect.sync(() => {
                  answers.push(result);
                }),
              ),
            ),
        }),
      ),
      Layer.succeed(
        AgentSessionHolder,
        AgentSessionHolder.make({
          versions: VERSIONS,
          current: Effect.succeed(SESSION),
          pollSettings: Effect.succeed(SESSION.poll),
          onExpired: () => Effect.void,
        }),
      ),
      Layer.succeed(
        DesiredStateCache,
        DesiredStateCache.make({
          latest: Effect.succeed(Option.some(desiredState({ instances: [desiredInstance()] }))),
          accept: unreached,
          restore: unreached(),
        }),
      ),
      Layer.succeed(
        SqliteSessions,
        SqliteSessions.make({
          syncDeployments: unreached,
          request: (query) =>
            Effect.sync(() => {
              invoked.push(query);
            }).pipe(Effect.andThen(execute(query))),
        }),
      ),
    );
    const fiber = yield* sqliteQueryLoop.pipe(Effect.provide(layer), Effect.forkScoped);
    return { fiber, polls, answers, invoked };
  });
}

describe('SQLite query polling', () => {
  test('advertises deployments and returns one outcome per claimed query', () =>
    run(
      Effect.gen(function* () {
        const host = yield* loopHost({
          queued: [QUERY],
          execute: () => Effect.succeed({ status: 'sequenced' }),
          send: Effect.void,
        });
        yield* TestClock.adjust('0 millis');
        expect(host.polls[0]?.servedDeployments).toEqual([LOG_SOURCE]);
        expect(host.invoked).toEqual([QUERY]);
        expect(host.answers).toEqual([
          { queryId: QUERY.queryId, outcome: { status: 'sequenced' } },
        ]);
      }),
    ));

  test('idle polls observe the polling floor', () =>
    run(
      Effect.gen(function* () {
        const host = yield* loopHost({ queued: [], execute: unreached, send: Effect.void });
        yield* TestClock.adjust('12 seconds');
        expect(host.polls).toHaveLength(POLLS_ACROSS_TWO_FLOORS);
        expect(host.invoked).toEqual([]);
      }),
    ));

  test('close is received while query execution is blocked', () =>
    run(
      Effect.gen(function* () {
        const running = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const host = yield* loopHost({
          queued: [QUERY, CLOSE],
          execute: (query) =>
            query.operation.type === 'close'
              ? Deferred.succeed(release, undefined).pipe(Effect.as({ status: 'closed' } as const))
              : Deferred.succeed(running, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.as({ status: 'sequenced' } as const),
                ),
          send: Effect.void,
        });
        yield* Deferred.await(running);
        yield* TestClock.adjust('0 millis');
        expect(host.invoked).toEqual([QUERY, CLOSE]);
        expect(host.answers.map((answer) => answer.outcome.status).sort()).toEqual([
          'closed',
          'sequenced',
        ]);
      }),
    ));

  test('bounds active requests while leaving close admission available', () =>
    run(
      Effect.gen(function* () {
        const pending = Array.from({ length: MAX_ACTIVE_SQLITE_QUERIES + 1 }, () =>
          sqliteQuery(QUERY.operation),
        );
        const host = yield* loopHost({
          queued: [...pending, CLOSE],
          execute: (query) =>
            query.operation.type === 'close' ? Effect.succeed({ status: 'closed' }) : Effect.never,
          send: Effect.void,
        });
        yield* TestClock.adjust('0 millis');
        expect(host.invoked).toHaveLength(MAX_ACTIVE_SQLITE_QUERIES + 1);
        expect(
          host.answers.some(
            (answer) => answer.outcome.status === 'failed' && answer.outcome.code === 'SQLITE_BUSY',
          ),
        ).toBe(true);
        expect(host.answers.some((answer) => answer.outcome.status === 'closed')).toBe(true);
        yield* Fiber.interrupt(host.fiber);
      }),
    ));

  test('interruption closes dispatched work without retrying SQL', () =>
    run(
      Effect.gen(function* () {
        const interrupted = yield* Ref.make(0);
        const started = yield* Deferred.make<void>();
        const host = yield* loopHost({
          queued: [QUERY],
          execute: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Ref.update(interrupted, (count) => count + 1)),
            ),
          send: Effect.void,
        });
        yield* Deferred.await(started);
        yield* Fiber.interrupt(host.fiber);
        expect(yield* Ref.get(interrupted)).toBe(1);
        expect(host.invoked).toEqual([QUERY]);
      }),
    ));
});
