import { expect, spyOn, test } from 'bun:test';
import { command } from '#commands/apps/sqlite/query/[sql].ts';
import { NAME } from '#tests/support/app.ts';
import { SQLITE_FRACTION, sqliteCli, sqliteQueryFixture } from '#tests/support/sqlite.ts';

test('the router forwards --app and --json around the quoted SQL and emits exactly one JSON result', async () => {
  const fixture = sqliteQueryFixture();
  const { cli, errors } = sqliteCli({ api: fixture.api, signedIn: true });
  const lines: string[] = [];
  const stdout = spyOn(process.stdout, 'write').mockImplementation(function write(chunk) {
    lines.push(String(chunk));
    return true;
  });
  const sql = 'SELECT "a b", 1 -- one quoted positional';
  try {
    expect(
      await cli.run([
        '--json',
        'apps',
        '--app',
        NAME,
        'sqlite',
        'query',
        '--connection',
        'connection-1',
        sql,
      ]),
    ).toBe(0);
  } finally {
    stdout.mockRestore();
  }
  expect(errors).toEqual([]);
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    columns: ['value', 'value', null, 'bytes', 'fraction'],
    rows: [['9223372036854775807', 'two\nlines', null, { base64: 'AP8=' }, SQLITE_FRACTION]],
  });
  expect(fixture.pipelines[0]?.body).toMatchObject({
    requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }],
  });
});

test('signed-out queries fail before app selection or SQL execution', async () => {
  const fixture = sqliteQueryFixture();
  const { cli, errors } = sqliteCli({ api: fixture.api, signedIn: false });
  expect(await cli.run(['apps', 'sqlite', 'query', 'SELECT 1', '--app', NAME, '--json'])).toBe(1);
  expect(errors).toEqual(['Not signed in. Run `nib login` or set NIBRUN_API_KEY.']);
  expect(fixture.addressedApps).toEqual([]);
  expect(fixture.pipelines).toEqual([]);
});

test('SQL errors produce a nonzero exit code and no JSON success payload', async () => {
  const fixture = sqliteQueryFixture({
    failure: { status: 409, value: { error: 'App suspended.' } },
  });
  const { cli, errors } = sqliteCli({ api: fixture.api, signedIn: true });
  const lines: string[] = [];
  const stdout = spyOn(process.stdout, 'write').mockImplementation(function write(chunk) {
    lines.push(String(chunk));
    return true;
  });
  try {
    expect(await cli.run(['apps', 'sqlite', 'query', 'SELECT 1', '--app', NAME, '--json'])).toBe(1);
  } finally {
    stdout.mockRestore();
  }
  expect(errors).toEqual(['The api answered 409: App suspended.']);
  expect(lines).toEqual([]);
});

test.each(['', ' ', '\n\t'])('blank SQL %j is rejected locally', function blank(sql) {
  expect(command.params.sql.schema.safeParse(sql).success).toBe(false);
});
