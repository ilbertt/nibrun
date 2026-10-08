import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { GuestPathSchema } from '@repo/protocol';
import {
  type HranaPipelineReqBody,
  SQLITE_MAX_RESPONSE_BYTES,
  SQLITE_MAX_STATEMENT_LENGTH,
} from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';
import { Duration, Effect, Fiber, TestClock, TestContext } from 'effect';
import { connectGuestSqlite } from '#lib/sqlite/client.ts';
import {
  GuestSqliteFailed,
  InvalidSqliteRequest,
  MalformedSqliteReply,
  SqliteDisconnected,
} from '#lib/sqlite/errors.ts';
import {
  servingSqliteGuest,
  sqliteHttpBytes,
  sqliteHttpResponse,
  sqlitePipelineResponse,
} from '#tests/support/guest-sqlite.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const PAST_RESPONSE_TIMEOUT_SECONDS = 11;
const HANDSHAKE_OPEN_AND_TWO_PIPELINES = 4;
const HANDSHAKE_OPEN_AND_ONE_PIPELINE = 3;
const HEX_RADIX = 16;
const MAX_PIPELINE_REQUESTS = 64;
const INVALID_UTF8_BYTE = 255;
const PATH = Value.Parse(GuestPathSchema, '/data/app name.db');
const PIPELINE: HranaPipelineReqBody = {
  baton: null,
  requests: [{ type: 'execute', stmt: { sql: 'SELECT 1' } }],
};

function guest(responses: readonly Buffer[]) {
  return Effect.gen(function* () {
    return yield* servingSqliteGuest({
      directory: yield* temporaryDirectory,
      responses,
      fragmented: false,
      handshake: 'OK 1024\n',
    });
  });
}

describe('SQLite guest HTTP client', () => {
  test('serializes pipelines over one fragmented HTTP connection without numeric loss', () =>
    run(
      Effect.gen(function* () {
        const server = yield* servingSqliteGuest({
          directory: yield* temporaryDirectory,
          responses: [sqliteHttpResponse({}), sqlitePipelineResponse(), sqlitePipelineResponse()],
          fragmented: true,
          handshake: 'OK 1024\n',
        });
        const client = yield* connectGuestSqlite({ socketPath: server.socketPath });
        yield* client.open(PATH);
        const results = yield* Effect.all([client.pipeline(PIPELINE), client.pipeline(PIPELINE)], {
          concurrency: 'unbounded',
        });
        expect(results[0]?.results[0]).toEqual({
          type: 'ok',
          response: {
            type: 'execute',
            result: {
              cols: [{ name: 'value', decltype: 'INTEGER' }],
              rows: [[{ type: 'integer', value: '9223372036854775807' }]],
              affected_row_count: 0,
              last_insert_rowid: null,
            },
          },
        });
        expect(server.requests[0]?.toString()).toBe('CONNECT 51005\n');
        expect(server.requests[1]?.toString()).toBe('GET /sqlite/%2Fdata%2Fapp%20name.db/v2\n');
        expect(server.requests).toHaveLength(HANDSHAKE_OPEN_AND_TWO_PIPELINES);
        expect(JSON.parse(server.requests[2]?.toString().split('\n')[1] ?? '')).toEqual(PIPELINE);
      }),
    ));
  test('uses the standard HTTP parser for chunked responses', () =>
    run(
      Effect.gen(function* () {
        const body = JSON.stringify({ baton: 'next', base_url: null, results: [] });
        const response = Buffer.from(
          `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n${body.length.toString(HEX_RADIX)}\r\n${body}\r\n0\r\n\r\n`,
        );
        const server = yield* guest([sqliteHttpResponse({}), response]);
        const client = yield* connectGuestSqlite({ socketPath: server.socketPath });
        yield* client.open(PATH);
        expect(yield* client.pipeline({ baton: null, requests: [] })).toEqual({
          baton: 'next',
          base_url: null,
          results: [],
        });
      }),
    ));
  test('SQL errors in successful HTTP pipelines leave the connection usable', () =>
    run(
      Effect.gen(function* () {
        const error = {
          type: 'error',
          error: { code: 'SQLITE_ERROR', message: 'syntax error' },
        } as const;
        const server = yield* guest([
          sqliteHttpResponse({}),
          sqliteHttpResponse({ baton: 'after-error', base_url: null, results: [error] }),
          sqlitePipelineResponse(),
        ]);
        const client = yield* connectGuestSqlite({ socketPath: server.socketPath });
        yield* client.open(PATH);
        expect((yield* client.pipeline(PIPELINE)).results).toEqual([error]);
        expect((yield* client.pipeline({ ...PIPELINE, baton: 'after-error' })).baton).toBe(
          'guest-baton',
        );
      }),
    ));
  test.each(['400 Bad Request', '500 Internal Server Error'])(
    'HTTP %s invalidates and closes the stream',
    (status) =>
      run(
        Effect.gen(function* () {
          const failure = JSON.stringify({ code: 'SQLITE_ERROR', message: 'syntax error' });
          const response = Buffer.from(
            `HTTP/1.1 ${status}\r\nContent-Length: ${failure.length}\r\nConnection: keep-alive\r\n\r\n${failure}`,
          );
          const server = yield* guest([sqliteHttpResponse({}), response, sqlitePipelineResponse()]);
          const client = yield* connectGuestSqlite({ socketPath: server.socketPath });
          yield* client.open(PATH);
          expect(yield* Effect.flip(client.pipeline(PIPELINE))).toEqual(
            new GuestSqliteFailed({ code: 'SQLITE_ERROR', reason: 'syntax error' }),
          );
          yield* Effect.promise(() => server.closed);
          expect(yield* Effect.flip(client.pipeline(PIPELINE))).toBeInstanceOf(SqliteDisconnected);
          expect(server.requests).toHaveLength(HANDSHAKE_OPEN_AND_ONE_PIPELINE);
        }),
      ),
  );
  test.each([
    sqliteHttpResponse({ results: 'invalid' }),
    sqliteHttpBytes(
      Buffer.concat([
        Buffer.from('{"baton":"'),
        Buffer.of(INVALID_UTF8_BYTE),
        Buffer.from('","base_url":null,"results":[]}'),
      ]),
    ),
    sqliteHttpResponse({ baton: 'next', base_url: 'http://guest/', results: [] }),
    Buffer.from(
      `HTTP/1.1 200 OK\r\nContent-Length: ${SQLITE_MAX_RESPONSE_BYTES + 1}\r\n\r\n${'x'.repeat(SQLITE_MAX_RESPONSE_BYTES + 1)}`,
    ),
  ])('rejects malformed or oversized responses and closes the guest', (response) =>
    run(
      Effect.gen(function* () {
        const server = yield* guest([sqliteHttpResponse({}), response]);
        const client = yield* connectGuestSqlite({ socketPath: server.socketPath });
        yield* client.open(PATH);
        expect(yield* Effect.flip(client.pipeline(PIPELINE))).toBeInstanceOf(MalformedSqliteReply);
        yield* Effect.promise(() => server.closed);
      }),
    ),
  );
  test('rejects oversized complete pipelines before sending SQL', () =>
    run(
      Effect.gen(function* () {
        const server = yield* guest([sqliteHttpResponse({})]);
        const client = yield* connectGuestSqlite({ socketPath: server.socketPath });
        yield* client.open(PATH);
        const requests: HranaPipelineReqBody['requests'] = Array.from(
          { length: MAX_PIPELINE_REQUESTS },
          () => ({ type: 'sequence', sql: ' '.repeat(SQLITE_MAX_STATEMENT_LENGTH) }),
        );
        expect(yield* Effect.flip(client.pipeline({ baton: null, requests }))).toBeInstanceOf(
          InvalidSqliteRequest,
        );
        expect(server.requests).toHaveLength(2);
      }),
    ));

  test.each(['OK 0\n', 'OK 9999999999\n', 'broken\n', 'x'.repeat(MAX_PIPELINE_REQUESTS + 1)])(
    'rejects an invalid vsock handshake and closes the socket',
    (handshake) =>
      run(
        Effect.gen(function* () {
          const server = yield* servingSqliteGuest({
            directory: yield* temporaryDirectory,
            responses: [],
            fragmented: false,
            handshake,
          });
          expect(
            yield* Effect.flip(connectGuestSqlite({ socketPath: server.socketPath })),
          ).toBeInstanceOf(MalformedSqliteReply);
          yield* Effect.promise(() => server.closed);
        }),
      ),
  );

  test('disconnecting a guest fails the pending pipeline without retrying', () =>
    run(
      Effect.gen(function* () {
        const server = yield* guest([sqliteHttpResponse({})]);
        const client = yield* connectGuestSqlite({ socketPath: server.socketPath });
        yield* client.open(PATH);
        const query = yield* client.pipeline(PIPELINE).pipe(Effect.flip, Effect.forkScoped);
        yield* Effect.yieldNow();
        yield* Effect.sync(server.disconnect);
        expect(yield* Fiber.join(query)).toBeInstanceOf(SqliteDisconnected);
        expect(server.requests.length).toBeLessThanOrEqual(HANDSHAKE_OPEN_AND_ONE_PIPELINE);
      }),
    ));
  test('a silent handshake times out and releases the socket', () =>
    run(
      Effect.gen(function* () {
        const server = yield* servingSqliteGuest({
          directory: yield* temporaryDirectory,
          responses: [],
          fragmented: false,
          handshake: '',
        });
        const pending = yield* connectGuestSqlite({ socketPath: server.socketPath }).pipe(
          Effect.flip,
          Effect.forkScoped,
        );
        yield* Effect.promise(() => server.connected);
        yield* TestClock.adjust(Duration.seconds(PAST_RESPONSE_TIMEOUT_SECONDS));
        expect(yield* Fiber.join(pending)).toBeInstanceOf(SqliteDisconnected);
        yield* Effect.promise(() => server.closed);
      }).pipe(Effect.provide(TestContext.TestContext)),
    ));
  test('a silent HTTP response times out and releases the socket', () =>
    run(
      Effect.gen(function* () {
        const server = yield* guest([]);
        const client = yield* connectGuestSqlite({ socketPath: server.socketPath });
        const pending = yield* client.open(PATH).pipe(Effect.flip, Effect.forkScoped);
        yield* TestClock.adjust(Duration.seconds(PAST_RESPONSE_TIMEOUT_SECONDS));
        expect(yield* Fiber.join(pending)).toBeInstanceOf(SqliteDisconnected);
        yield* Effect.promise(() => server.closed);
      }).pipe(Effect.provide(TestContext.TestContext)),
    ));
});
