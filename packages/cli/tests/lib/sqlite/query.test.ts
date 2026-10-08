import { expect, test } from 'bun:test';
import { querySqlite, renderSqliteRows, SQLITE_QUERY_OUTPUT } from '#lib/sqlite/query.ts';
import { writerRecording } from '#tests/support/output.ts';
import { SQLITE_FRACTION, sqliteConnection, sqliteQueryFixture } from '#tests/support/sqlite.ts';

test('query output preserves column order, duplicate names and every SQLite value kind', async () => {
  const fixture = sqliteQueryFixture();
  const connection = sqliteConnection();
  const sql = 'SELECT * FROM sample LIMIT 20';
  const value = SQLITE_QUERY_OUTPUT.schema.parse(
    await querySqlite({ api: fixture.api, connection, sql }),
  );
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
