import { expect, test } from 'bun:test';
import { GuestPathSchema, Value } from '@repo/protocol';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { SqliteService } from '#services/sqlite.service.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  OTHER_OWNER_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';
import { sqliteSelectionFixture } from '#tests/support/sqlite-selection.ts';

const PATH = Value.Parse(GuestPathSchema, '/app.db');
const FAILED_OPEN_ATTEMPTS = 100;
const SIGNAL = new AbortController().signal;

test('selecting a database verifies it on the current owned deployment', async () => {
  const fixture = sqliteSelectionFixture();
  const service = new SqliteService(fixture);
  const selected = await service.select({
    appId: APP_ID,
    ownerId: OWNER_ID,
    path: PATH,
    signal: SIGNAL,
  });
  expect(selected).toMatchObject({ appId: APP_ID, deploymentId: DEPLOYMENT_ID, path: PATH });
  expect(selected.url).toBe(`https://api.test/api/sqlite/connections/${selected.id}/`);
  expect(new Date(selected.expiresAt).getTime()).toBeGreaterThan(Date.now());
  expect(fixture.opened).toEqual([
    expect.objectContaining({ appId: APP_ID, deploymentId: DEPLOYMENT_ID, path: PATH }),
  ]);
  expect(fixture.executors[0]?.closed).toBe(true);
  expect(fixture.asked).toEqual([{ appId: APP_ID, ownerId: OWNER_ID }]);
});

test('another owner cannot select an app or close its selection', async () => {
  const fixture = sqliteSelectionFixture();
  const service = new SqliteService(fixture);
  await expect(
    service.select({ appId: APP_ID, ownerId: OTHER_OWNER_ID, path: PATH, signal: SIGNAL }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(fixture.opened).toHaveLength(0);
  const selected = await service.select({
    appId: APP_ID,
    ownerId: OWNER_ID,
    path: PATH,
    signal: SIGNAL,
  });
  expect(function closeAsOtherOwner() {
    service.closeSelection({ id: selected.id, ownerId: OTHER_OWNER_ID });
  }).toThrow(NotFoundError);
  service.closeSelection({ id: selected.id, ownerId: OWNER_ID });
});

test('a stopped deployment is refused before contacting its host', async () => {
  const fixture = sqliteSelectionFixture();
  fixture.deployment.state = 'stopped';
  await expect(
    new SqliteService(fixture).select({
      appId: APP_ID,
      ownerId: OWNER_ID,
      path: PATH,
      signal: SIGNAL,
    }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(fixture.opened).toHaveLength(0);
});

test('a database that fails to open leaves no occupied selections', async () => {
  const fixture = sqliteSelectionFixture();
  const service = new SqliteService({
    ...fixture,
    openExecutor() {
      return Promise.reject(new Error('not a database'));
    },
  });
  for (let attempt = 0; attempt < FAILED_OPEN_ATTEMPTS; attempt += 1) {
    await expect(
      service.select({ appId: APP_ID, ownerId: OWNER_ID, path: PATH, signal: SIGNAL }),
    ).rejects.toThrow('not a database');
  }
});
