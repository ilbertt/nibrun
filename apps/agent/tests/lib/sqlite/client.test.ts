import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { GuestPathSchema, Value } from '@repo/protocol';
import { Deferred, Duration, Effect, Fiber, TestClock, TestContext } from 'effect';
import { connectGuestSqlite } from '#lib/sqlite/client.ts';
import { GuestSqliteFailed, SqliteDisconnected } from '#lib/sqlite/errors.ts';
import { servingSqliteGuest } from '#tests/support/guest-sqlite.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import {
  SQLITE_REPLY,
  SQLITE_UINT32_BYTES,
  sqliteFrame,
  sqliteResultFrame,
} from '#tests/support/sqlite.ts';

const run = provided(platform);
const EXPECTED_REQUEST_COUNT = 4;
const PAST_RESPONSE_TIMEOUT_SECONDS = 11;
const STATEMENT = { sql: 'SELECT 1', args: [], named_args: [], want_rows: true };

describe('SQLite guest client', () => {
  test('serializes concurrent requests over one fragmented guest stream', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingSqliteGuest({
          directory: yield* temporaryDirectory,
          responses: [
            sqliteFrame({ code: SQLITE_REPLY.ok, body: Buffer.alloc(0) }),
            sqliteResultFrame(),
            sqliteResultFrame(),
          ],
          fragmented: true,
          handshake: 'OK 1024\n',
        });
        const client = yield* connectGuestSqlite({ socketPath: guest.socketPath });
        expect(
          yield* client.request({ type: 'open', path: Value.Parse(GuestPathSchema, '/app.db') }),
        ).toEqual({ kind: 'ok' });
        const results = yield* Effect.all(
          [
            client.request({ type: 'execute', statement: STATEMENT }),
            client.request({ type: 'execute', statement: STATEMENT }),
          ],
          { concurrency: 'unbounded' },
        );
        expect(results.map((reply) => reply.kind)).toEqual(['result', 'result']);
        expect(guest.requests[0]?.toString()).toBe('CONNECT 51005\n');
        expect(guest.requests).toHaveLength(EXPECTED_REQUEST_COUNT);
      }),
    ));

  test('a complete SQL error leaves the connection usable', () =>
    run(
      Effect.gen(function* () {
        const error = Buffer.alloc(SQLITE_UINT32_BYTES);
        error.writeUInt32BE(1);
        const guest = yield* servingSqliteGuest({
          directory: yield* temporaryDirectory,
          responses: [
            sqliteFrame({
              code: SQLITE_REPLY.error,
              body: Buffer.concat([error, Buffer.from('syntax error')]),
            }),
            sqliteResultFrame(),
          ],
          fragmented: false,
          handshake: 'OK 1024\n',
        });
        const client = yield* connectGuestSqlite({ socketPath: guest.socketPath });
        expect(
          yield* Effect.flip(client.request({ type: 'execute', statement: STATEMENT })),
        ).toEqual(new GuestSqliteFailed({ code: 1, reason: 'syntax error' }));
        expect((yield* client.request({ type: 'execute', statement: STATEMENT })).kind).toBe(
          'result',
        );
      }),
    ));

  test('disconnecting a guest fails the pending request without retrying', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingSqliteGuest({
          directory: yield* temporaryDirectory,
          responses: [],
          fragmented: false,
          handshake: 'OK 1024\n',
        });
        const client = yield* connectGuestSqlite({ socketPath: guest.socketPath });
        const requested = yield* Deferred.make<void>();
        const query = yield* client.request({ type: 'execute', statement: STATEMENT }).pipe(
          Effect.tap(() => Deferred.succeed(requested, undefined)),
          Effect.flip,
          Effect.forkScoped,
        );
        yield* Effect.yieldNow();
        yield* Effect.sync(guest.disconnect);
        expect(yield* Fiber.join(query)).toBeInstanceOf(SqliteDisconnected);
        expect(guest.requests.length).toBeLessThanOrEqual(2);
      }),
    ));

  test('a silent handshake times out and releases the connection', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingSqliteGuest({
          directory: yield* temporaryDirectory,
          responses: [],
          fragmented: false,
          handshake: '',
        });
        const pending = yield* connectGuestSqlite({ socketPath: guest.socketPath }).pipe(
          Effect.flip,
          Effect.forkScoped,
        );
        yield* Effect.promise(() => guest.connected);
        yield* TestClock.adjust(Duration.seconds(PAST_RESPONSE_TIMEOUT_SECONDS));
        expect(yield* Fiber.join(pending)).toBeInstanceOf(SqliteDisconnected);
        yield* Effect.promise(() => guest.closed);
        expect(guest.requests).toHaveLength(1);
      }).pipe(Effect.provide(TestContext.TestContext)),
    ));
});
