import { expect, test } from 'bun:test';
import { GuestPathSchema, type SqliteOutcome, type SqliteQuery, Value } from '@repo/protocol';
import { openRemoteSqliteExecutor } from '#lib/sqlite/remote-executor.ts';
import { SqliteRelayService } from '#services/sqlite-relay.service.ts';
import {
  SQLITE_DEPLOYMENT,
  SQLITE_HOST_ID,
  SQLITE_OTHER_HOST_ID,
  SQLITE_STATEMENT,
} from '#tests/support/sqlite.ts';

const signal = new AbortController().signal;
const path = Value.Parse(GuestPathSchema, '/app.db');
const RESULT = {
  columns: [{ name: 'value' }],
  rows: [[{ type: 'integer' as const, value: '1' }]],
  affectedRowCount: 0,
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
  const opening = openRemoteSqliteExecutor({ relay, ...SQLITE_DEPLOYMENT, path, signal });
  const query = await claim(relay);
  answer({ relay, query, outcome: { status: 'opened' } });
  const executor = await opening;
  return { relay, executor, sessionId: query.sessionId };
}

test('the remote executor preserves its session and host across every operation', async () => {
  const { relay, executor, sessionId } = await fixture();
  const execution = executor.execute({ statement: SQLITE_STATEMENT, signal });
  const other = await relay.pendingQuery({
    hostId: SQLITE_OTHER_HOST_ID,
    servedDeployments: [SQLITE_DEPLOYMENT],
    signal: AbortSignal.abort(),
  });
  expect(other).toBeUndefined();
  const query = await claim(relay);
  expect(query.sessionId).toBe(sessionId);
  expect(query.operation).toEqual({ type: 'execute', statement: SQLITE_STATEMENT });
  answer({ relay, query, outcome: { status: 'executed', result: RESULT } });
  expect(await execution).toEqual(RESULT);
  const description = executor.describe({ sql: 'SELECT 1', signal });
  const described = await claim(relay);
  const metadata = {
    parameters: [],
    columns: [{ name: 'value' }],
    isExplain: false,
    isReadonly: true,
  };
  answer({ relay, query: described, outcome: { status: 'described', result: metadata } });
  expect(await description).toEqual(metadata);
  const sequence = executor.sequence({ sql: 'SELECT 1; SELECT 2;', signal });
  answer({ relay, query: await claim(relay), outcome: { status: 'sequenced' } });
  await sequence;
  const closed = executor.close();
  expect(executor.close() === closed).toBe(true);
  const closing = await claim(relay);
  expect(closing.operation.type).toBe('close');
  expect(closing.sessionId).toBe(sessionId);
  answer({ relay, query: closing, outcome: { status: 'closed' } });
  await closed;
  await expect(executor.execute({ statement: SQLITE_STATEMENT, signal })).rejects.toThrow('closed');
});

test('SQL errors preserve the stream while protocol mismatches close it', async () => {
  const { relay, executor } = await fixture();
  const first = executor.execute({ statement: SQLITE_STATEMENT, signal });
  answer({
    relay,
    query: await claim(relay),
    outcome: { status: 'failed', code: 'SQLITE_BUSY', message: 'locked' },
  });
  await expect(first).rejects.toMatchObject({ code: 'SQLITE_BUSY', message: 'locked' });
  const second = executor.execute({ statement: SQLITE_STATEMENT, signal });
  answer({ relay, query: await claim(relay), outcome: { status: 'opened' } });
  const closing = await claim(relay);
  expect(closing.operation.type).toBe('close');
  answer({ relay, query: closing, outcome: { status: 'closed' } });
  await expect(second).rejects.toThrow('unexpected');
});

test('cancellation closes through an independent signal and never replays SQL', async () => {
  const { relay, executor, sessionId } = await fixture();
  const controller = new AbortController();
  const execution = executor.execute({ statement: SQLITE_STATEMENT, signal: controller.signal });
  const original = await claim(relay);
  expect(original.operation.type).toBe('execute');
  controller.abort(new Error('cancelled'));
  const closing = await claim(relay);
  expect(closing.operation.type).toBe('close');
  expect(closing.sessionId).toBe(sessionId);
  answer({ relay, query: closing, outcome: { status: 'closed' } });
  await expect(execution).rejects.toThrow('cancelled');
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
  const opening = openRemoteSqliteExecutor({
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
  const { relay, executor } = await fixture();
  const execution = executor.execute({ statement: SQLITE_STATEMENT, signal });
  answer({
    relay,
    query: await claim(relay),
    outcome: { status: 'failed', code: 'SqliteDisconnected', message: 'Guest disconnected' },
  });
  const closing = await claim(relay);
  expect(closing.operation.type).toBe('close');
  const close = executor.close();
  expect(executor.close() === close).toBe(true);
  answer({ relay, query: closing, outcome: { status: 'closed' } });
  await expect(execution).rejects.toMatchObject({ code: 'SqliteDisconnected' });
  await close;
  await expect(executor.execute({ statement: SQLITE_STATEMENT, signal })).rejects.toMatchObject({
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
