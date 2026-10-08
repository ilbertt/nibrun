import { expect, test } from 'bun:test';
import { DeploymentIdSchema, GuestPathSchema } from '@repo/protocol';
import { HranaError } from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { SqliteService } from '#services/sqlite.service.ts';
import { APP_ID, OTHER_OWNER_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';
import { sqliteConnectionsFixture } from '#tests/support/sqlite-connections.ts';

const SELECT = { type: 'execute', stmt: { sql: 'SELECT 1', want_rows: true } };
const SIGNAL = new AbortController().signal;
const PATH = Value.Parse(GuestPathSchema, '/app.db');

async function selectedFixture() {
  const fixture = sqliteConnectionsFixture();
  const service = new SqliteService(fixture);
  const selected = await service.create({
    appId: APP_ID,
    ownerId: OWNER_ID,
    sqlite_file_path: PATH,
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
  expect(fixture.sessions).toHaveLength(2);
  expect(fixture.sessions[1]?.pipelines).toHaveLength(2);
  await service.removeConnection({ appId: APP_ID, id, ownerId: OWNER_ID });
  expect(fixture.sessions[1]?.closed).toBe(true);
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
  expect(fixture.sessions[1]?.closed).toBe(true);
  expect(fixture.sessions[1]?.pipelines).toHaveLength(1);
  await service.removeConnection({ appId: APP_ID, id, ownerId: OWNER_ID });
});

test('a baton cannot query another connection even for the same owner', async () => {
  const fixture = await selectedFixture();
  const { service, id } = fixture;
  const other = await service.create({
    appId: APP_ID,
    ownerId: OWNER_ID,
    sqlite_file_path: PATH,
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
  await service.removeConnection({ appId: APP_ID, id, ownerId: OWNER_ID });
  await service.removeConnection({ appId: APP_ID, id: other.id, ownerId: OWNER_ID });
});

test('closing a connection invalidates all its streams', async () => {
  const fixture = await selectedFixture();
  const { service, id } = fixture;
  await service.pipeline({ id, ownerId: OWNER_ID, body: { requests: [SELECT] }, signal: SIGNAL });
  await service.removeConnection({ appId: APP_ID, id, ownerId: OWNER_ID });
  await expect(
    service.pipeline({ id, ownerId: OWNER_ID, body: { requests: [SELECT] }, signal: SIGNAL }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(fixture.sessions[1]?.closed).toBe(true);
});

test('the saved URL survives redeployment while old batons expire', async () => {
  const fixture = await selectedFixture();
  const { service, id } = fixture;
  const saved = await service.list({ appId: APP_ID, ownerId: OWNER_ID });
  const first = await service.pipeline({
    id,
    ownerId: OWNER_ID,
    body: { requests: [SELECT] },
    signal: SIGNAL,
  });
  fixture.deployment.id = Value.Parse(DeploymentIdSchema, 'replacement-deployment');
  await expect(
    service.pipeline({
      id,
      ownerId: OWNER_ID,
      body: { baton: first.baton, requests: [SELECT] },
      signal: SIGNAL,
    }),
  ).rejects.toBeInstanceOf(HranaError);
  expect(fixture.sessions[1]?.closed).toBe(true);
  await service.pipeline({ id, ownerId: OWNER_ID, body: { requests: [SELECT] }, signal: SIGNAL });
  expect(fixture.opened.at(-1)?.deploymentId).toBe(fixture.deployment.id);
  expect(await service.list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual(saved);
  await service.removeConnection({ appId: APP_ID, id, ownerId: OWNER_ID });
});

test('a new API service can query an existing saved connection', async () => {
  const fixture = await selectedFixture();
  const replacement = new SqliteService(fixture);
  const response = await replacement.pipeline({
    id: fixture.id,
    ownerId: OWNER_ID,
    body: { requests: [SELECT, { type: 'close' }] },
    signal: SIGNAL,
  });
  expect(response.results[0]?.type).toBe('ok');
  expect(response.baton).toBeNull();
  await replacement.removeConnection({ appId: APP_ID, id: fixture.id, ownerId: OWNER_ID });
});
