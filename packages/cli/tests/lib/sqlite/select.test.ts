import { beforeEach, expect, test } from 'bun:test';
import { APP_ID } from '#tests/support/app.ts';
import { recordingPrompts } from '#tests/support/prompts.ts';
import { sqliteConnection, sqliteQueryFixture } from '#tests/support/sqlite.ts';

const prompts = await recordingPrompts();
const { selectSqliteConnection } = await import('#lib/sqlite/select.ts');

beforeEach(function reset() {
  prompts.reset();
});

test('the only saved connection is selected without a prompt, including in scripts', async () => {
  const connection = sqliteConnection();
  const fixture = sqliteQueryFixture({ connections: [connection] });
  expect(
    await selectSqliteConnection({
      api: fixture.api,
      appId: APP_ID,
      connectionId: undefined,
      interactive: false,
    }),
  ).toEqual(connection);
  expect(fixture.addressedApps).toEqual([APP_ID]);
  expect(prompts.asked).toEqual([]);
});

test('an explicit connection ID selects within the app even when there are several databases', async () => {
  const second = sqliteConnection({ id: 'connection-2', sqlite_file_path: '/second.db' });
  const fixture = sqliteQueryFixture({ connections: [sqliteConnection(), second] });
  expect(
    await selectSqliteConnection({
      api: fixture.api,
      appId: APP_ID,
      connectionId: second.id,
      interactive: false,
    }),
  ).toEqual(second);
  expect(prompts.asked).toEqual([]);
});

test('a connection belonging to another app cannot bypass app selection', async () => {
  const fixture = sqliteQueryFixture();
  await expect(
    selectSqliteConnection({
      api: fixture.api,
      appId: APP_ID,
      connectionId: 'other-app-connection',
      interactive: true,
    }),
  ).rejects.toThrow('No SQLite connection other-app-connection saved for this app.');
  expect(fixture.pipelines).toEqual([]);
  expect(prompts.asked).toEqual([]);
});

test('no databases gives the command that creates a connection', async () => {
  const fixture = sqliteQueryFixture({ connections: [] });
  await expect(
    selectSqliteConnection({
      api: fixture.api,
      appId: APP_ID,
      connectionId: undefined,
      interactive: true,
    }),
  ).rejects.toThrow('nib apps sqlite connections create <path>');
  expect(prompts.asked).toEqual([]);
});

test('scripts must disambiguate multiple connections', async () => {
  const fixture = sqliteQueryFixture({
    connections: [sqliteConnection(), sqliteConnection({ id: 'second' })],
  });
  await expect(
    selectSqliteConnection({
      api: fixture.api,
      appId: APP_ID,
      connectionId: undefined,
      interactive: false,
    }),
  ).rejects.toThrow('Pass --connection');
  expect(prompts.asked).toEqual([]);
});

test('interactive selection offers paths and IDs and escapes tenant filenames', async () => {
  const second = sqliteConnection({ id: 'second', sqlite_file_path: '/two\nlines.db' });
  const fixture = sqliteQueryFixture({ connections: [sqliteConnection(), second] });
  prompts.answers.chosen = second.id;
  expect(
    await selectSqliteConnection({
      api: fixture.api,
      appId: APP_ID,
      connectionId: undefined,
      interactive: true,
    }),
  ).toEqual(second);
  expect(prompts.asked[0]).toMatchObject({
    message: 'Which SQLite database?',
    options: [
      { value: 'connection-1', label: '"/app.db"', hint: 'connection-1' },
      { value: 'second', label: '"/two\\nlines.db"', hint: 'second' },
    ],
  });
});

test('cancelling selection never executes a query', async () => {
  const fixture = sqliteQueryFixture({
    connections: [sqliteConnection(), sqliteConnection({ id: 'second' })],
  });
  prompts.answers.chosen = Symbol('cancel');
  await expect(
    selectSqliteConnection({
      api: fixture.api,
      appId: APP_ID,
      connectionId: undefined,
      interactive: true,
    }),
  ).rejects.toThrow('Cancelled.');
  expect(fixture.pipelines).toEqual([]);
});
