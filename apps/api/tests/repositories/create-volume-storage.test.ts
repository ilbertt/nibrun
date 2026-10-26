import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { HostIdSchema, HostnameSchema, ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { AppNameSchema } from '#lib/api/app.ts';
import { DnsLabelSchema } from '#lib/api/dns-label.ts';
import { ArtifactIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';
import type { CreateVolumeStorage } from '#lib/api/volume-storage.ts';
import { configWithDefaults, toAppConfig } from '#lib/app-config.ts';
import { sealVolumeStorage, toVolumeStorageMetadata } from '#lib/volume-storage.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';
import { volumeStorageInputs } from '#tests/support/volume-storage.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const OWNER_ID = Value.Parse(OwnerIdSchema, 'storage-owner');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'another-owner');
const HOST_ID = Value.Parse(HostIdSchema, 'storage-host');
const APP_QUOTA = 10;
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'owner', 'storage@example.test', true, now(), now())`,
    [OWNER_ID],
  );
  await sql.unsafe('UPDATE nibrun.profiles SET quota_apps_max_count = $2 WHERE owner_id = $1', [
    OWNER_ID,
    APP_QUOTA,
  ]);
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

function repository() {
  return new AppsRepository(withTypes<Queries>(sql));
}

async function createApp(storage: CreateVolumeStorage | undefined) {
  const name = storage?.auth.kind ?? 'shared';
  const result = await repository().create({
    ownerId: OWNER_ID,
    name: Value.Parse(AppNameSchema, name),
    slug: Value.Parse(DnsLabelSchema, name),
    hostname: Value.Parse(HostnameSchema, `${name}.example.test`),
    anonymousAppsAtMost: null,
    config: {
      ...configWithDefaults(),
      environment: {},
      ...(storage === undefined
        ? {}
        : { volumeStorage: sealVolumeStorage({ key: TEST_SECRETS_KEY, storage }) }),
    },
  });
  if (result.outcome !== 'created') {
    throw new Error('Test app creation was declined');
  }
  return result.app;
}

test.each(volumeStorageInputs())(
  'creation persists $auth.kind storage before the first deployment',
  async (storage) => {
    const app = await createApp(storage);
    const { auth, encryptionPassword, ...target } = storage;
    const prefix = Value.Parse(ObjectKeySchema, `apps/${app.id}/`);
    const metadata = { ...target, prefix, auth: { kind: auth.kind } };
    expect(toVolumeStorageMetadata(app)).toEqual(metadata);
    expect(app).not.toHaveProperty('volume_storage_secret_access_key');
    expect(await repository().findById({ appId: app.id, ownerId: OTHER_OWNER_ID })).toBeNull();
    expect(
      toVolumeStorageMetadata((await repository().findById({ appId: app.id, ownerId: OWNER_ID }))!),
    ).toEqual(metadata);
    expect(
      toVolumeStorageMetadata(
        (await repository().listByOwner({ ownerId: OWNER_ID })).find((row) => row.id === app.id)!,
      ),
    ).toEqual(metadata);
    const changed = await repository().update({
      appId: app.id,
      ownerId: OWNER_ID,
      patch: { name: undefined, args: ['changed'] },
    });
    expect(toVolumeStorageMetadata(changed!)).toEqual(metadata);
    const [artifact] = await sql.unsafe(
      `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
     SELECT id, 'sha256:storage', 1, 'artifacts/storage', 'app'
     FROM nibrun.apps WHERE id = $1 AND owner_id = $2 RETURNING id`,
      [app.id, OWNER_ID],
    );
    const deployments = new DeploymentsRepository(withTypes<Queries>(sql));
    const created = await deployments.insert({
      appId: app.id,
      ownerId: OWNER_ID,
      artifactId: Value.Parse(ArtifactIdSchema, artifact.id),
      initialDataFrom: null,
      onlyOne: false,
    });
    if (created.outcome !== 'created') {
      throw new Error('Test deployment creation was declined');
    }
    expect(toAppConfig(created.row).volumeStorage).toEqual(metadata);
    await repository().update({
      appId: app.id,
      ownerId: OWNER_ID,
      patch: { name: undefined, args: ['newer-config'] },
    });
    const deployment = await deployments.findById({
      appId: app.id,
      ownerId: OWNER_ID,
      deploymentId: created.row.id,
    });
    expect(toAppConfig(deployment!)).toMatchObject({ args: ['changed'], volumeStorage: metadata });
    const listed = await deployments.listByApp({ appId: app.id, ownerId: OWNER_ID });
    expect(toAppConfig(listed[0]!).volumeStorage).toEqual(metadata);
    const rollback = await deployments.insertRollback({
      appId: app.id,
      ownerId: OWNER_ID,
      rollbackOf: created.row.id,
    });
    expect(toAppConfig(rollback!)).toMatchObject({ args: ['changed'], volumeStorage: metadata });
    const desired = await new AgentRepository({
      sql: withTypes<Queries>(sql),
      secretsKey: TEST_SECRETS_KEY,
    }).desiredState({ hostId: HOST_ID });
    expect(desired.volumes.find((volume) => volume.appId === app.id)?.storage).toEqual({
      ...storage,
      prefix,
    });
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain(encryptionPassword);
    expect(serialized).not.toContain('secretAccessKey');
    expect(serialized).not.toContain('sessionToken');
  },
);

test('omitting storage preserves shared storage and the existing default config', async () => {
  const app = await createApp(undefined);
  expect(toVolumeStorageMetadata(app)).toBeUndefined();
  expect(toAppConfig(app)).not.toHaveProperty('volumeStorage');
  const [stored] = await sql.unsafe(
    `SELECT c.volume_storage_endpoint, c.volume_storage_bucket, c.volume_storage_prefix,
            c.volume_storage_auth_kind, c.volume_storage_secret_access_key,
            c.volume_storage_session_token, c.volume_storage_encryption_password
     FROM nibrun.app_configs c JOIN nibrun.apps a ON a.id = c.app_id
     WHERE a.id = $1 AND a.owner_id = $2`,
    [app.id, OWNER_ID],
  );
  expect(Object.values(stored).every((value) => value === null)).toBe(true);
});
