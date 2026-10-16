import { expect, spyOn, test } from 'bun:test';
import { DeploymentIdSchema, GuestPathSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { SqliteService } from '#services/sqlite.service.ts';
import { APP_ID, OTHER_OWNER_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';
import { sqliteConnectionsFixture } from '#tests/support/sqlite-connections.ts';

const PATH = Value.Parse(GuestPathSchema, '/app.db');
const SIGNAL = new AbortController().signal;
const QUERY = {
  appId: APP_ID,
  ownerId: OWNER_ID,
  sqlite_file_path: PATH,
  stmt: { sql: 'SELECT ? AS value', args: [{ type: 'integer' as const, value: '1' }] },
  signal: SIGNAL,
};

test('querying a new file creates a saved connection and closes its SQL session', async () => {
  const fixture = sqliteConnectionsFixture();
  const result = await new SqliteService(fixture).query(QUERY);
  expect(result).toEqual({ cols: [], rows: [], affected_row_count: 0, last_insert_rowid: null });
  expect(fixture.records).toHaveLength(1);
  expect(fixture.records[0]?.sqlite_file_path).toBe(PATH);
  expect(fixture.sessions).toHaveLength(2);
  expect(fixture.sessions.every((session) => session.closed)).toBe(true);
  expect(fixture.sessions[1]?.pipelines).toEqual([
    {
      baton: null,
      requests: [{ type: 'execute', stmt: { ...QUERY.stmt, want_rows: true } }, { type: 'close' }],
    },
  ]);
});

test('subsequent queries reuse the saved connection and follow the running deployment', async () => {
  const fixture = sqliteConnectionsFixture();
  const service = new SqliteService(fixture);
  await service.query(QUERY);
  const saved = fixture.records.slice();
  const sessionsBeforeRedeploy = fixture.sessions.length;
  fixture.deployment.id = Value.Parse(DeploymentIdSchema, 'replacement-deployment');
  await service.query(QUERY);
  expect(fixture.records).toEqual(saved);
  expect(fixture.sessions).toHaveLength(sessionsBeforeRedeploy + 1);
  expect(fixture.sessions[2]?.closed).toBe(true);
  expect(fixture.opened[2]).toEqual({
    appId: APP_ID,
    deploymentId: fixture.deployment.id,
    path: PATH,
    signal: SIGNAL,
  });
});

test('each database file gets its own saved connection', async () => {
  const fixture = sqliteConnectionsFixture();
  const service = new SqliteService(fixture);
  const otherPath = Value.Parse(GuestPathSchema, '/other.db');
  await service.query({ ...QUERY, sqlite_file_path: otherPath });
  await service.query(QUERY);
  await service.query(QUERY);
  expect(fixture.records.map((row) => row.sqlite_file_path)).toEqual([otherPath, PATH]);
  expect(fixture.opened.at(-1)?.path).toBe(PATH);
});

test('another owner cannot query a saved database or create its connection', async () => {
  const fixture = sqliteConnectionsFixture();
  const service = new SqliteService(fixture);
  await service.query(QUERY);
  const opened = fixture.opened.length;
  await expect(service.query({ ...QUERY, ownerId: OTHER_OWNER_ID })).rejects.toBeInstanceOf(
    NotFoundError,
  );
  expect(fixture.opened).toHaveLength(opened);
  expect(fixture.records).toHaveLength(1);
});

test('an existing connection cannot query a stopped deployment', async () => {
  const fixture = sqliteConnectionsFixture();
  const service = new SqliteService(fixture);
  await service.query(QUERY);
  fixture.deployment.state = 'stopped';
  await expect(service.query(QUERY)).rejects.toBeInstanceOf(ConflictError);
  expect(fixture.sessions).toHaveLength(2);
});

test('failed connection creation does not execute SQL or save a connection', async () => {
  const fixture = sqliteConnectionsFixture();
  spyOn(fixture, 'openSession').mockRejectedValue(new Error('not a database'));
  await expect(new SqliteService(fixture).query(QUERY)).rejects.toThrow('not a database');
  expect(fixture.sessions).toHaveLength(0);
  expect(fixture.records).toHaveLength(0);
});

test('SQL errors propagate after the query stream closes', async () => {
  const fixture = sqliteConnectionsFixture();
  const openSession = fixture.openSession;
  fixture.openSession = async function open(input) {
    const session = await openSession(input);
    const pipeline = session.pipeline.bind(session);
    spyOn(session, 'pipeline').mockImplementation(async function failStatement(request) {
      const response = await pipeline(request);
      return {
        ...response,
        results: response.results.map((result) =>
          result.type === 'ok' && result.response.type === 'execute'
            ? {
                type: 'error' as const,
                error: { code: 'SQLITE_ERROR', message: 'no such table: missing' },
              }
            : result,
        ),
      };
    });
    return session;
  };
  await expect(new SqliteService(fixture).query(QUERY)).rejects.toThrow('no such table: missing');
  expect(fixture.sessions.every((session) => session.closed)).toBe(true);
});
