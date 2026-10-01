import { describe, expect, test } from 'bun:test';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  CRON_TIME_ZONE,
  type CronQueryResult,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SecretStringSchema,
  Value,
} from '@repo/protocol';
import { Deferred, Effect, Exit, Fiber } from 'effect';
import { makeControlPlaneClient } from '#lib/control/client.ts';
import { CRON_QUERY } from '#tests/support/crons.ts';
import { LOG_SOURCE } from '#tests/support/fixtures.ts';
import { runScoped } from '#tests/support/run.ts';
import { HTTP_NO_CONTENT, recordingServer, serving } from '#tests/support/server.ts';

const SESSION_TOKEN = Value.Parse(SecretStringSchema, 'session-token');

describe('cron query transport', () => {
  test('polls carry served deployments and validate the query response', () =>
    runScoped(
      Effect.gen(function* () {
        const { baseUrl, received } = yield* recordingServer({
          body: { result: 'query', query: CRON_QUERY },
        });
        const response = yield* makeControlPlaneClient({ baseUrl }).fetchCronQuery({
          sessionToken: SESSION_TOKEN,
          request: { servedDeployments: [LOG_SOURCE] },
        });
        expect(response).toEqual({ result: 'query', query: CRON_QUERY });
        expect(received[0]?.url).toBe(`${baseUrl}${AGENT_API_PREFIX}${AGENT_ROUTES.cronQuery}`);
        expect(received[0]?.headers.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
        expect(received[0]?.headers[PROTOCOL_VERSION_HEADER]).toBe(String(PROTOCOL_VERSION));
        expect(JSON.parse(received[0]!.body)).toEqual({ servedDeployments: [LOG_SOURCE] });
      }),
    ));

  test('results are posted on their own route and acknowledge without a body', () =>
    runScoped(
      Effect.gen(function* () {
        const { baseUrl, received } = yield* recordingServer({ status: HTTP_NO_CONTENT });
        const result: CronQueryResult = {
          queryId: CRON_QUERY.queryId,
          outcome: {
            status: 'listed' as const,
            listing: { ...LOG_SOURCE, enabled: false, timeZone: CRON_TIME_ZONE, jobs: [] },
          },
        };
        expect(
          yield* makeControlPlaneClient({ baseUrl }).sendCronQueryResult({
            sessionToken: SESSION_TOKEN,
            result,
          }),
        ).toBeUndefined();
        expect(received[0]?.url).toBe(
          `${baseUrl}${AGENT_API_PREFIX}${AGENT_ROUTES.cronQueryResult}`,
        );
        expect(JSON.parse(received[0]!.body)).toEqual(result);
      }),
    ));

  test('a malformed deployment-scoped response is rejected at the boundary', () =>
    runScoped(
      Effect.gen(function* () {
        const { baseUrl } = yield* recordingServer({
          body: {
            result: 'query',
            query: { queryId: CRON_QUERY.queryId, appId: CRON_QUERY.appId },
          },
        });
        const error = yield* Effect.flip(
          makeControlPlaneClient({ baseUrl }).fetchCronQuery({
            sessionToken: SESSION_TOKEN,
            request: { servedDeployments: [LOG_SOURCE] },
          }),
        );
        expect(String(error)).toContain('does not match the protocol');
      }),
    ));

  test('interrupting a held poll closes the HTTP request, not just its waiting fiber', () =>
    runScoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const disconnected = yield* Deferred.make<void>();
        const { baseUrl } = yield* serving((request) => {
          Effect.runSync(Deferred.succeed(started, undefined));
          return new Promise<Response>((resolve) => {
            request.signal.addEventListener(
              'abort',
              () => {
                Effect.runSync(Deferred.succeed(disconnected, undefined));
                resolve(new Response(null, { status: HTTP_NO_CONTENT }));
              },
              { once: true },
            );
          });
        });
        const poll = yield* Effect.forkScoped(
          makeControlPlaneClient({ baseUrl }).fetchCronQuery({
            sessionToken: SESSION_TOKEN,
            request: { servedDeployments: [LOG_SOURCE] },
          }),
        );
        yield* Deferred.await(started);
        const exit = yield* Fiber.interrupt(poll);
        yield* Deferred.await(disconnected).pipe(Effect.timeout('1 second'));
        expect(Exit.isInterrupted(exit)).toBe(true);
      }),
    ));
});
