import { expect, test } from 'bun:test';
import { removeSqliteConnection, SQLITE_CONNECTION_REMOVED_OUTPUT } from '#lib/sqlite/remove.ts';
import { answering, apiHolding, listedApp } from '#tests/support/api.ts';
import { APP_ID } from '#tests/support/app.ts';
import { writerRecording } from '#tests/support/output.ts';

test('removal addresses the saved connection within the selected app and reports its ID', async () => {
  const removed: Array<{ appId: string; connectionId: string }> = [];
  const api = apiHolding({
    apps: [listedApp()],
    underApp: function underApp({ appId }) {
      return {
        sqlite: {
          connections: function connections({ connectionId }: { connectionId: string }) {
            return {
              delete: function remove() {
                removed.push({ appId, connectionId });
                return answering({ deleted: true })();
              },
            };
          },
        },
      };
    },
  });
  const value = SQLITE_CONNECTION_REMOVED_OUTPUT.schema.parse(
    await removeSqliteConnection({ api, appId: APP_ID, connectionId: 'connection-1' }),
  );
  expect(removed).toEqual([{ appId: APP_ID, connectionId: 'connection-1' }]);
  expect(value).toEqual({ appId: APP_ID, connectionId: 'connection-1', deleted: true });
  const out = writerRecording();
  SQLITE_CONNECTION_REMOVED_OUTPUT.render({ value, out });
  expect(out.said).toEqual([`Removed SQLite connection connection-1 from app ${APP_ID}.`]);
});

test('a missing connection reports the API failure instead of claiming it was removed', async () => {
  const api = apiHolding({
    apps: [listedApp()],
    underApp: function underApp() {
      return {
        sqlite: {
          connections: function connections() {
            return {
              delete: function remove() {
                return Promise.resolve({
                  data: null,
                  error: { status: 404, value: { error: 'Database connection not found.' } },
                });
              },
            };
          },
        },
      };
    },
  });
  await expect(
    removeSqliteConnection({ api, appId: APP_ID, connectionId: 'missing' }),
  ).rejects.toThrow('404: Database connection not found.');
});
