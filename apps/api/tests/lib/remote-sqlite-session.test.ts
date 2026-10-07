import { expect, test } from 'bun:test';
import { GuestPathSchema, type SqliteOutcome, type SqliteQuery } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { openRemoteSqliteSession } from '#lib/sqlite/remote-session.ts';
import { SqliteRelayService } from '#services/sqlite-relay.service.ts';
import {
  SQLITE_DEPLOYMENT,
  SQLITE_HOST_ID,
  SQLITE_OTHER_HOST_ID,
  SQLITE_PIPELINE,
} from '#tests/support/sqlite.ts';

const signal = new AbortController().signal;
const path = Value.Parse(GuestPathSchema, '/app.db');
const RESULT = {
  baton: 'guest-baton',
  base_url: null,
  results: [
    {
      type: 'ok' as const,
      response: {
        type: 'execute' as const,
        result: {
          cols: [{ name: 'value', decltype: null }],
          rows: [[{ type: 'integer' as const, value: '1' }]],
          affected_row_count: 0,
          last_insert_rowid: null,
        },
      },
    },
  ],
};

async function claim(relay: SqliteRelayService): Promise<SqliteQuery> {
  const WAIT_MS = 1_000;
  const query = await relay.pendingQuery({
    hostId: SQLITE_HOST_ID,
    servedDeployments: [SQLITE_DEPLOYMENT],
    signal: AbortSignal.timeout(WAIT_MS),
  });
  if (!query) {
    throw new Error('SQLite operation was not offered');
  }
  return query;
}

function answer({
  relay,
  query,
  outcome,
}: {
  relay: SqliteRelayService;
  query: SqliteQuery;
  outcome: SqliteOutcome;
}): void {
  relay.acceptResult({ queryId: query.queryId, hostId: SQLITE_HOST_ID, outcome });
}

async function fixture() {
  const relay = new SqliteRelayService();
  const opening = openRemoteSqliteSession({ relay, ...SQLITE_DEPLOYMENT, path, signal });
  const query = await claim(relay);
  answer({ relay, query, outcome: { status: 'opened' } });
  const session = await opening;
  return { relay, session, sessionId: query.sessionId };
}

test('the remote session preserves its session and host across every operation', async () => {
  const { relay, session, sessionId } = await fixture();
  const pipeline = session.pipeline({ body: SQLITE_PIPELINE, signal });
  const other = await relay.pendingQuery({
    hostId: SQLITE_OTHER_HOST_ID,
    servedDeployments: [SQLITE_DEPLOYMENT],
    signal: AbortSignal.abort(),
  });
  expect(other).toBeUndefined();
  const query = await claim(relay);
  expect(query.sessionId).toBe(sessionId);
  expect(query.operation).toEqual({ type: 'pipeline', body: SQLITE_PIPELINE });
  answer({ relay, query, outcome: { status: 'pipelined', result: RESULT } });
  expect(await pipeline).toEqual(RESULT);
  const closed = session.close();
  expect(session.close() === closed).toBe(true);
  const closing = await claim(relay);
  expect(closing.operation.type).toBe('close');
  expect(closing.sessionId).toBe(sessionId);
  answer({ relay, query: closing, outcome: { status: 'closed' } });
  await closed;
  await expect(session.pipeline({ body: SQLITE_PIPELINE, signal })).rejects.toThrow('closed');
});

test('SQL errors preserve the stream while protocol mismatches close it', async () => {
  const { relay, session } = await fixture();
  const first = session.pipeline({ body: SQLITE_PIPELINE, signal });
  answer({
    relay,
    query: await claim(relay),
    outcome: {
      status: 'pipelined',
      result: {
        baton: 'guest-baton',
        base_url: null,
        results: [{ type: 'error', error: { code: 'SQLITE_BUSY', message: 'locked' } }],
      },
    },
  });
  expect((await first).results[0]).toEqual({
    type: 'error',
    error: { code: 'SQLITE_BUSY', message: 'locked' },
  });
  const second = session.pipeline({ body: SQLITE_PIPELINE, signal });
  answer({ relay, query: await claim(relay), outcome: { status: 'opened' } });
  const closing = await claim(relay);
  expect(closing.operation.type).toBe('close');
  answer({ relay, query: closing, outcome: { status: 'closed' } });
  await expect(second).rejects.toThrow('unexpected');
});

test('cancellation closes through an independent signal and never replays SQL', async () => {
  const { relay, session, sessionId } = await fixture();
  const controller = new AbortController();
  const pipeline = session.pipeline({ body: SQLITE_PIPELINE, signal: controller.signal });
  const original = await claim(relay);
  expect(original.operation.type).toBe('pipeline');
  controller.abort(new Error('cancelled'));
  const closing = await claim(relay);
  expect(closing.operation.type).toBe('close');
  expect(closing.sessionId).toBe(sessionId);
  answer({ relay, query: closing, outcome: { status: 'closed' } });
  await expect(pipeline).rejects.toThrow('cancelled');
  expect(
    await relay.pendingQuery({
      hostId: SQLITE_HOST_ID,
      servedDeployments: [SQLITE_DEPLOYMENT],
      signal: AbortSignal.abort(),
    }),
  ).toBeUndefined();
});

test('an opening request can abort promptly while a late answer still closes the new session', async () => {
  const relay = new SqliteRelayService();
  const controller = new AbortController();
  const opening = openRemoteSqliteSession({
    relay,
    ...SQLITE_DEPLOYMENT,
    path,
    signal: controller.signal,
  });
  const query = await claim(relay);
  controller.abort(new Error('cancelled'));
  await expect(opening).rejects.toThrow('cancelled');
  answer({ relay, query, outcome: { status: 'opened' } });
  const closing = await claim(relay);
  expect(closing.sessionId).toBe(query.sessionId);
  expect(closing.operation.type).toBe('close');
  answer({ relay, query: closing, outcome: { status: 'closed' } });
});

test('a disconnected guest closes its stream once and cannot accept more statements', async () => {
  const { relay, session } = await fixture();
  const pipeline = session.pipeline({ body: SQLITE_PIPELINE, signal });
  answer({
    relay,
    query: await claim(relay),
    outcome: { status: 'failed', code: 'SqliteDisconnected', message: 'Guest disconnected' },
  });
  const closing = await claim(relay);
  expect(closing.operation.type).toBe('close');
  const close = session.close();
  expect(session.close() === close).toBe(true);
  answer({ relay, query: closing, outcome: { status: 'closed' } });
  await expect(pipeline).rejects.toMatchObject({ code: 'SqliteDisconnected' });
  await close;
  await expect(session.pipeline({ body: SQLITE_PIPELINE, signal })).rejects.toMatchObject({
    code: 'STREAM_CLOSED',
  });
  expect(
    await relay.pendingQuery({
      hostId: SQLITE_HOST_ID,
      servedDeployments: [SQLITE_DEPLOYMENT],
      signal: AbortSignal.abort(),
    }),
  ).toBeUndefined();
});
