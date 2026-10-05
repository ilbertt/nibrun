import { expect, test } from 'bun:test';
import { GuestPathSchema, Value } from '@repo/protocol';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { HranaError } from '#lib/hrana/errors.ts';
import { SqliteService } from '#services/sqlite.service.ts';
import { APP_ID, OTHER_OWNER_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';
import { sqliteSelectionFixture } from '#tests/support/sqlite-selection.ts';

const SELECT = { type: 'execute', stmt: { sql: 'SELECT 1', want_rows: true } };
const SIGNAL = new AbortController().signal;
const PATH = Value.Parse(GuestPathSchema, '/app.db');

async function selectedFixture() {
  const fixture = sqliteSelectionFixture();
  const service = new SqliteService(fixture);
  const selected = await service.select({
    appId: APP_ID,
    ownerId: OWNER_ID,
    path: PATH,
    signal: SIGNAL,
  });
  return { ...fixture, service, id: selected.id };
}

test('each pipeline checks ownership and keeps its selected connection', async () => {
  const fixture = await selectedFixture();
  const { service, id } = fixture;
  const first = await service.pipeline({
    id,
    ownerId: OWNER_ID,
    body: { requests: [SELECT] },
    signal: SIGNAL,
  });
  await expect(
    service.pipeline({
      id,
      ownerId: OTHER_OWNER_ID,
      body: { baton: first.baton, requests: [SELECT] },
      signal: SIGNAL,
    }),
  ).rejects.toBeInstanceOf(NotFoundError);
  const second = await service.pipeline({
    id,
    ownerId: OWNER_ID,
    body: { baton: first.baton, requests: [SELECT] },
    signal: SIGNAL,
  });
  expect(second.baton).not.toBe(first.baton);
  expect(fixture.executors).toHaveLength(2);
  expect(fixture.executors[1]?.statements).toHaveLength(2);
  await service.closeSelection({ id, ownerId: OWNER_ID });
  expect(fixture.executors[1]?.closed).toBe(true);
});

test('redeployment invalidates batons before any further SQL runs', async () => {
  const fixture = await selectedFixture();
  const { service, id } = fixture;
  const first = await service.pipeline({
    id,
    ownerId: OWNER_ID,
    body: { requests: [SELECT] },
    signal: SIGNAL,
  });
  fixture.deployment.state = 'superseded';
  await expect(
    service.pipeline({
      id,
      ownerId: OWNER_ID,
      body: { baton: first.baton, requests: [SELECT] },
      signal: SIGNAL,
    }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(fixture.executors[1]?.closed).toBe(true);
  expect(fixture.executors[1]?.statements).toHaveLength(1);
  await service.closeSelection({ id, ownerId: OWNER_ID });
});

test('a baton cannot query another selection even for the same owner', async () => {
  const fixture = await selectedFixture();
  const { service, id } = fixture;
  const other = await service.select({
    appId: APP_ID,
    ownerId: OWNER_ID,
    path: PATH,
    signal: SIGNAL,
  });
  const first = await service.pipeline({
    id,
    ownerId: OWNER_ID,
    body: { requests: [SELECT] },
    signal: SIGNAL,
  });
  await expect(
    service.pipeline({
      id: other.id,
      ownerId: OWNER_ID,
      body: { baton: first.baton, requests: [SELECT] },
      signal: SIGNAL,
    }),
  ).rejects.toBeInstanceOf(HranaError);
  await service.closeSelection({ id, ownerId: OWNER_ID });
  await service.closeSelection({ id: other.id, ownerId: OWNER_ID });
});

test('closing a selection invalidates all its streams', async () => {
  const fixture = await selectedFixture();
  const { service, id } = fixture;
  await service.pipeline({ id, ownerId: OWNER_ID, body: { requests: [SELECT] }, signal: SIGNAL });
  await service.closeSelection({ id, ownerId: OWNER_ID });
  await expect(
    service.pipeline({ id, ownerId: OWNER_ID, body: { requests: [SELECT] }, signal: SIGNAL }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(fixture.executors[1]?.closed).toBe(true);
});
