import { expect, test } from 'bun:test';
import { createClient } from '@libsql/client/http';
import type { SqliteOutcome, SqliteQuery } from '@repo/protocol';
import { GuestPathSchema } from '@repo/protocol';
import type { HranaStreamRequest, HranaStreamResult } from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { elysiaErrorHandler } from '#lib/errors.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { openRemoteSqliteSession } from '#lib/sqlite/remote-session.ts';
import { SqliteService } from '#services/sqlite.service.ts';
import { SqliteRelayService } from '#services/sqlite-relay.service.ts';
import '#tests/controllers/support/api.ts';
import { APP_ID, DEPLOYMENT_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';
import { SQLITE_HOST_ID } from '#tests/support/sqlite.ts';
import { sqliteConnectionsFixture } from '#tests/support/sqlite-connections.ts';

const { createSqliteConnectionsConnectionIdV2Controller } = await import(
  '#routes/api/sqlite/connections/[connectionId]/v2/controller.ts'
);
const AUTHORIZATION = 'Bearer existing-account-session';
const LARGE_INTEGER = '9223372036854775807';
const BOUND_INTEGER = 7n;
const RESULT = {
  cols: [{ name: 'value', decltype: 'INTEGER' }],
  rows: [[{ type: 'integer' as const, value: LARGE_INTEGER }]],
  affected_row_count: 0,
  last_insert_rowid: null,
};

function existingAccountAuth(): Auth {
  return {
    api: {
      getSession({ headers }: { headers: Headers }) {
        return Promise.resolve(
          headers.get('authorization') === AUTHORIZATION
            ? { user: { id: OWNER_ID, isAnonymous: false }, session: {} }
            : null,
        );
      },
    },
  } as unknown as Auth;
}

function guestResponse(request: HranaStreamRequest): HranaStreamResult {
  switch (request.type) {
    case 'execute':
      return { type: 'ok', response: { type: request.type, result: RESULT } };
    case 'batch':
      return {
        type: 'ok',
        response: {
          type: request.type,
          result: {
            step_results: request.batch.steps.map(function result() {
              return RESULT;
            }),
            step_errors: request.batch.steps.map(function error() {
              return null;
            }),
          },
        },
      };
    case 'close':
    case 'store_sql':
    case 'close_sql':
    case 'sequence':
      return { type: 'ok', response: { type: request.type } };
    case 'describe':
      throw new Error('Unexpected description in SDK relay fixture');
  }
}

async function fixture() {
  const relay = new SqliteRelayService();
  const queries: SqliteQuery[] = [];
  const stopping = new AbortController();
  async function serveGuest() {
    while (!stopping.signal.aborted) {
      const query = await relay.pendingQuery({
        hostId: SQLITE_HOST_ID,
        servedDeployments: [{ appId: APP_ID, deploymentId: DEPLOYMENT_ID }],
        signal: stopping.signal,
      });
      if (!query) {
        break;
      }
      queries.push(query);
      let outcome: SqliteOutcome;
      switch (query.operation.type) {
        case 'open':
          outcome = { status: 'opened' };
          break;
        case 'close':
          outcome = { status: 'closed' };
          break;
        case 'pipeline':
          outcome = {
            status: 'pipelined',
            result: {
              baton: query.operation.body.requests.some(function closing(request) {
                return request.type === 'close';
              })
                ? null
                : `private-${queries.length}`,
              base_url: 'http://guest.invalid/',
              results: query.operation.body.requests.map(guestResponse),
            },
          };
          break;
      }
      relay.acceptResult({ hostId: SQLITE_HOST_ID, queryId: query.queryId, outcome });
    }
  }
  const guest = serveGuest();
  const connections = sqliteConnectionsFixture();
  const baseUrl = new URL('http://127.0.0.1');
  const service = new SqliteService({
    ...connections,
    baseUrl,
    openSession(input) {
      return openRemoteSqliteSession({ ...input, relay });
    },
  });
  const ApiController = new Elysia({ prefix: RoutePrefix.Api }).use(
    createSqliteConnectionsConnectionIdV2Controller({
      authPlugin: createAuthPlugin(existingAccountAuth()),
      sqliteServicePlugin: new Elysia({ name: 'service.sqlite' })
        .decorate('sqliteService', service)
        .decorate('sqliteOrigin', baseUrl.origin),
    }),
  );
  const app = new Elysia().onError(elysiaErrorHandler).use(ApiController);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      return app.handle(request);
    },
  });
  baseUrl.port = String(server.port);
  const selected = await service.create({
    appId: APP_ID,
    ownerId: OWNER_ID,
    sqlite_file_path: Value.Parse(GuestPathSchema, '/app.db'),
    signal: stopping.signal,
  });
  const client = createClient({
    url: selected.url,
    intMode: 'bigint',
    fetch(input: Parameters<typeof fetch>[0]) {
      const request = input instanceof Request ? input : new Request(input.toString());
      request.headers.set('authorization', AUTHORIZATION);
      return fetch(input, { headers: request.headers });
    },
  });
  async function close() {
    client.close();
    await service.removeConnection({ appId: APP_ID, ownerId: OWNER_ID, id: selected.id });
    await server.stop(true);
    stopping.abort();
    await guest;
  }
  return { client, selected, queries, close, app };
}

test('the official SDK authenticates through the public controller and relays complete guest pipelines', async () => {
  const connection = await fixture();
  try {
    const unauthenticated = createClient({ url: connection.selected.url });
    await expect(unauthenticated.execute('SELECT 1')).rejects.toThrow('401');
    unauthenticated.close();
    expect(connection.queries).toHaveLength(2);
    const transaction = await connection.client.transaction('read');
    const first = await transaction.execute({ sql: 'SELECT ?', args: [BOUND_INTEGER] });
    const second = await transaction.execute('SELECT 2');
    expect(first.rows[0]?.value).toBe(BigInt(LARGE_INTEGER));
    expect(second.rows[0]?.value).toBe(BigInt(LARGE_INTEGER));
    await transaction.commit();
    const pipelines = connection.queries.filter(function pipeline(query) {
      return query.operation.type === 'pipeline';
    });
    expect(pipelines.length).toBeGreaterThan(1);
    expect(
      pipelines[0]?.operation.type === 'pipeline' ? pipelines[0].operation.body.baton : undefined,
    ).toBeNull();
    expect(
      pipelines[1]?.operation.type === 'pipeline' ? pipelines[1].operation.body.baton : undefined,
    ).toStartWith('private-');
    expect(
      new Set(
        pipelines.map(function session(query) {
          return query.sessionId;
        }),
      ).size,
    ).toBe(1);
    expect(
      connection.queries.every(function wholePipeline(query) {
        return ['open', 'pipeline', 'close'].includes(query.operation.type);
      }),
    ).toBe(true);
  } finally {
    await connection.close();
  }
});

test('SQLite browser clients can preflight and query with a bearer token without enabling cookie access', async () => {
  const connection = await fixture();
  const url = `${connection.selected.url}v2/pipeline`;
  const origin = 'https://client.test';
  try {
    const discovery = await fetch(`${connection.selected.url}v2`, {
      headers: { origin, authorization: AUTHORIZATION },
    });
    expect(discovery.status).toBe(StatusMap.OK);
    expect(discovery.headers.get('access-control-allow-origin')).toBe(origin);
    expect(await discovery.json()).toEqual({});
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.status).toBe(StatusMap['No Content']);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-headers')).toBe(
      'Authorization, Content-Type',
    );
    expect(preflight.headers.has('access-control-allow-credentials')).toBe(false);
    const response = await fetch(url, {
      method: 'POST',
      headers: { origin, authorization: AUTHORIZATION, 'content-type': 'application/json' },
      body: JSON.stringify({
        baton: null,
        requests: [
          { type: 'execute', stmt: { sql: 'SELECT 1', want_rows: true } },
          { type: 'close' },
        ],
      }),
    });
    expect(response.status).toBe(StatusMap.OK);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    const denied = await fetch(url, {
      method: 'POST',
      headers: {
        origin,
        authorization: AUTHORIZATION,
        cookie: 'session=account-session',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ baton: null, requests: [] }),
    });
    expect(denied.status).toBe(StatusMap.Forbidden);
    expect(denied.headers.has('access-control-allow-credentials')).toBe(false);
    const unauthorized = await fetch(url, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ baton: null, requests: [] }),
    });
    expect(unauthorized.status).toBe(StatusMap.Unauthorized);
    expect(unauthorized.headers.get('access-control-allow-origin')).toBe(origin);
    for (const authorization of [
      'Bearer invalid-session',
      'Bearer ',
      'Basic existing-account-session',
    ]) {
      const invalid = await fetch(url, {
        method: 'POST',
        headers: { origin, authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ baton: null, requests: [] }),
      });
      expect(invalid.status).toBe(StatusMap.Unauthorized);
      expect(invalid.headers.get('access-control-allow-origin')).toBe(origin);
    }
    const unrelated = await connection.app.handle(
      new Request(new URL(`${RoutePrefix.Api}/unrelated`, connection.selected.url).href),
    );
    expect(unrelated.headers.has('access-control-allow-origin')).toBe(false);
  } finally {
    await connection.close();
  }
});
