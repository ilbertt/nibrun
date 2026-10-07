import { expect, test } from 'bun:test';
import { querySqlite, renderSqliteRows, SQLITE_QUERY_OUTPUT } from '#lib/sqlite/query.ts';
import { writerRecording } from '#tests/support/output.ts';
import {
  SQLITE_FRACTION,
  SQLITE_QUERY_RESPONSE,
  sqliteConnection,
  sqliteQueryFixture,
} from '#tests/support/sqlite.ts';

test('queries execute and close in one pipeline and preserve column order, duplicate names and every SQLite value kind', async () => {
  const fixture = sqliteQueryFixture();
  const connection = sqliteConnection();
  const sql = 'SELECT * FROM sample LIMIT 20';
  const value = SQLITE_QUERY_OUTPUT.schema.parse(
    await querySqlite({ api: fixture.api, connection, sql }),
  );
  expect(fixture.pipelines).toEqual([
    {
      connectionId: connection.id,
      body: {
        baton: null,
        requests: [{ type: 'execute', stmt: { sql, want_rows: true } }, { type: 'close' }],
      },
    },
  ]);
  expect(value).toEqual({
    connection,
    columns: ['value', 'value', null, 'bytes', 'fraction'],
    rows: [['9223372036854775807', 'two\nlines', null, { base64: 'AP8=' }, SQLITE_FRACTION]],
  });
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  const out = writerRecording();
  SQLITE_QUERY_OUTPUT.render({ value, out });
  expect(out.said.join('\n')).toContain('9223372036854775807');
  expect(out.said.join('\n')).toContain('two\\nlines');
  expect(out.said.join('\n')).toContain('base64:AP8=');
  expect(out.said.at(-1)).toBe('1 row.');
});

test.each(['SQLITE_AUTH', 'SQLITE_ERROR'])(
  '%s errors inside an HTTP-successful pipeline still fail the command, with close requested',
  async function failedQuery(code) {
    const fixture = sqliteQueryFixture({
      response: {
        ...SQLITE_QUERY_RESPONSE,
        results: [
          { type: 'error', error: { code, message: 'Query refused.' } },
          { type: 'ok', response: { type: 'close' } },
        ],
      },
    });
    await expect(
      querySqlite({ api: fixture.api, connection: sqliteConnection(), sql: 'DELETE FROM users' }),
    ).rejects.toThrow(`${code}: Query refused.`);
    expect(fixture.pipelines).toHaveLength(1);
    expect(fixture.pipelines[0]?.body).toMatchObject({
      requests: [{ type: 'execute' }, { type: 'close' }],
    });
  },
);

test('HTTP failures report the API error rather than an empty result', async () => {
  const fixture = sqliteQueryFixture({
    failure: { status: 409, value: { error: 'The app needs a running deployment.' } },
  });
  await expect(
    querySqlite({ api: fixture.api, connection: sqliteConnection(), sql: 'SELECT 1' }),
  ).rejects.toThrow('409: The app needs a running deployment.');
});

test('closing failures are surfaced after an otherwise successful query', async () => {
  const fixture = sqliteQueryFixture({
    response: {
      ...SQLITE_QUERY_RESPONSE,
      results: [
        SQLITE_QUERY_RESPONSE.results[0]!,
        { type: 'error', error: { message: 'Stream expired.' } },
      ],
    },
  });
  await expect(
    querySqlite({ api: fixture.api, connection: sqliteConnection(), sql: 'SELECT 1' }),
  ).rejects.toThrow('Stream expired.');
});

test('an incomplete pipeline response cannot be emitted as a successful query', async () => {
  const fixture = sqliteQueryFixture({ response: { ...SQLITE_QUERY_RESPONSE, results: [] } });
  await expect(
    querySqlite({ api: fixture.api, connection: sqliteConnection(), sql: 'SELECT 1' }),
  ).rejects.toThrow('unexpected SQLite query response');
});

test('table columns remain aligned and text cannot inject terminal controls', () => {
  expect(
    renderSqliteRows({
      columns: ['id', 'name'],
      rows: [
        ['7', 'A'],
        ['123', 'two\nlines\u001b[31m'],
      ],
    }),
  ).toEqual(['id   name', '7    A', '123  two\\nlines\\u001b[31m']);
});

test('zero rows retain their column headings', () => {
  expect(renderSqliteRows({ columns: ['id'], rows: [] })).toEqual(['id']);
  const out = writerRecording();
  SQLITE_QUERY_OUTPUT.render({
    value: { connection: sqliteConnection(), columns: ['id'], rows: [] },
    out,
  });
  expect(out.said.at(-1)).toBe('0 rows.');
});
