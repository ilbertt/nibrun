import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { AppIdSchema, DeploymentIdSchema, GuestPathSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Duration, Effect, Exit, Fiber, Layer, Ref, TestClock, TestContext } from 'effect';
import { AgentState } from '#services/agent-state.service.ts';
import { GuestActivity } from '#services/guest-activity.service.ts';
import { APP_ID, desiredInstance, desiredState, instanceRecord } from '#tests/support/fixtures.ts';
import { sqliteHttpResponse, sqlitePipelineResponse } from '#tests/support/guest-sqlite.ts';
import { platform, provided } from '#tests/support/run.ts';
import { sqliteHost, sqliteQuery } from '#tests/support/sqlite-sessions.ts';

const run = provided(Layer.mergeAll(platform, AgentState.Default, GuestActivity.Default));
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
  test('keeps one guest connection and protects the guest between requests', () =>
    run(
      Effect.gen(function* () {
        const host = yield* sqliteHost([OPEN_RESPONSE, sqlitePipelineResponse()]);
        expect(yield* host.sessions.request(OPEN)).toEqual({ status: 'opened' });
        expect((yield* host.sessions.request(QUERY)).status).toBe('pipelined');
        expect(yield* Ref.get(host.wakes)).toBe(0);
        const slept = yield* Ref.make(false);
        const activity = yield* GuestActivity;
        yield* activity.whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) });
        expect(yield* Ref.get(slept)).toBe(false);
        expect(yield* host.sessions.request(CLOSED)).toEqual({ status: 'closed' });
        yield* Effect.promise(() => host.guest.closed);
        yield* activity.whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) });
        expect(yield* Ref.get(slept)).toBe(true);
      }),
    ));

  test('HTTP transport failures release the session and guest activity immediately', () =>
    run(
      Effect.gen(function* () {
        const failure = JSON.stringify({ code: 'PROTO_ERROR', message: 'Invalid stream' });
        const response = Buffer.from(
          `HTTP/1.1 400 Bad Request\r\nContent-Length: ${failure.length}\r\nConnection: keep-alive\r\n\r\n${failure}`,
        );
        const host = yield* sqliteHost([OPEN_RESPONSE, response]);
        yield* host.sessions.request(OPEN);
        expect((yield* host.sessions.request(QUERY)).status).toBe('failed');
        yield* Effect.promise(() => host.guest.closed);
        const slept = yield* Ref.make(false);
        yield* (yield* GuestActivity).whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) });
        expect(yield* Ref.get(slept)).toBe(true);
        expect((yield* host.sessions.request(QUERY)).status).toBe('failed');
      }),
    ));

  test('wakes idle guests while holding protection and rechecks deployment afterwards', () =>
    run(
      Effect.gen(function* () {
        const host = yield* sqliteHost([OPEN_RESPONSE]);
        yield* host.cache.accept(
          desiredState({ instances: [desiredInstance({ desiredState: 'on-request' })] }),
        );
        yield* AgentState.putRecord(
          instanceRecord({ state: 'idle', onRequest: true, stopRequested: true }),
        );
        const slept = yield* Ref.make(false);
        yield* Ref.set(
          host.onWake,
          (yield* GuestActivity).whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) }),
        );
        expect(yield* host.sessions.request(OPEN)).toEqual({ status: 'opened' });
        expect(yield* Ref.get(host.wakes)).toBe(1);
        expect(yield* Ref.get(slept)).toBe(false);
      }),
    ));

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
          const slept = yield* Ref.make(false);
          yield* (yield* GuestActivity).whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) });
          expect(yield* Ref.get(slept)).toBe(true);
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

  test('an abandoned session expires and releases idle protection', () =>
    run(
      Effect.gen(function* () {
        const host = yield* sqliteHost([OPEN_RESPONSE]);
        yield* host.sessions.request(OPEN);
        yield* TestClock.adjust(Duration.seconds(PAST_IDLE_TIMEOUT_SECONDS));
        yield* Effect.promise(() => host.guest.closed);
        expect((yield* host.sessions.request(QUERY)).status).toBe('failed');
        const slept = yield* Ref.make(false);
        yield* (yield* GuestActivity).whenIdle({ appId: APP_ID, effect: Ref.set(slept, true) });
        expect(yield* Ref.get(slept)).toBe(true);
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

  test('deployment changes during wake prevent opening the guest socket', () =>
    run(
      Effect.gen(function* () {
        const host = yield* sqliteHost([OPEN_RESPONSE]);
        yield* host.cache.accept(
          desiredState({ instances: [desiredInstance({ desiredState: 'on-request' })] }),
        );
        yield* AgentState.putRecord(instanceRecord({ state: 'idle', onRequest: true }));
        yield* Ref.set(
          host.onWake,
          host.cache
            .accept(
              desiredState({ instances: [desiredInstance({ deploymentId: NEXT_DEPLOYMENT })] }),
            )
            .pipe(Effect.asVoid, Effect.orDie, Effect.provide(platform)),
        );
        expect((yield* host.sessions.request(OPEN)).status).toBe('failed');
        expect(host.guest.requests).toEqual([]);
      }),
    ));
});
