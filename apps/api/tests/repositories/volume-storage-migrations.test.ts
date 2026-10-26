import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { AppIdSchema, HostIdSchema, type S3VolumeAuth, S3VolumeAuthSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { openSecret, sealSecret } from '#lib/tenant-secrets.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import {
  type VolumeStorageMigrationDestination,
  VolumeStorageMigrationsRepository,
} from '#repositories/volume-storage-migrations.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const OWNER_ID = Value.Parse(OwnerIdSchema, 'migration-owner');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'migration-other');
const HOST_ID = Value.Parse(HostIdSchema, 'migration-host');
const ACCESS_KEY_AUTH = Value.Parse(S3VolumeAuthSchema, {
  kind: 'access-key',
  accessKeyId: 'test-access',
  secretAccessKey: 'test-secret',
});
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [ownerId, `${ownerId}@example.test`],
    );
  }
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

function repository() {
  return new VolumeStorageMigrationsRepository(withTypes<Queries>(sql));
}

function sealed(plaintext: string) {
  return sealSecret({ key: TEST_SECRETS_KEY, plaintext });
}

function destination(auth: S3VolumeAuth): VolumeStorageMigrationDestination {
  return {
    volume_storage_endpoint: 'https://objects.example.test',
    volume_storage_bucket: 'customer-data',
    volume_storage_region: auth.kind === 'session' ? 'auto' : null,
    volume_storage_auth_kind: auth.kind,
    volume_storage_access_key_id: auth.kind === 'anonymous' ? null : auth.accessKeyId,
    volume_storage_secret_access_key:
      auth.kind === 'anonymous' ? null : sealed(auth.secretAccessKey),
    volume_storage_session_token: auth.kind === 'session' ? sealed(auth.sessionToken) : null,
    volume_storage_encryption_password: sealed('filesystem-password'),
  };
}

async function desiredVolumes() {
  return (
    await new AgentRepository({
      sql: withTypes<Queries>(sql),
      secretsKey: TEST_SECRETS_KEY,
    }).desiredState({ hostId: HOST_ID })
  ).volumes;
}

test.each([
  ACCESS_KEY_AUTH,
  Value.Parse(S3VolumeAuthSchema, {
    kind: 'session',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    sessionToken: 'test-token',
  }),
  { kind: 'anonymous' as const },
])('a pending $kind destination leaves the live config and volume unchanged', async (auth) => {
  const appId = await createApp({ name: auth.kind, deployed: true, configured: false });
  const before = await desiredVolumes();
  const target = destination(auth);
  const job = await repository().request({ appId, ownerId: OWNER_ID, destination: target });
  if (job === null) {
    throw new Error('The deployed shared app must accept a migration request.');
  }
  expect(job).toMatchObject({
    app_id: appId,
    state: 'pending',
    volume_storage_bucket: target.volume_storage_bucket,
  });
  expect(job.created_at).toBeInstanceOf(Date);
  expect(job.updated_at).toBeInstanceOf(Date);
  expect(String(job.volume_storage_prefix)).toBe(`apps/${appId}/${job.id}/`);
  expect(job).not.toHaveProperty('volume_storage_access_key_id');
  expect(job).not.toHaveProperty('volume_storage_secret_access_key');
  expect(job).not.toHaveProperty('volume_storage_session_token');
  expect(job).not.toHaveProperty('volume_storage_encryption_password');
  expect(await desiredVolumes()).toEqual(before);
  const [current] = await sql.unsafe(
    `SELECT c.id, c.volume_storage_endpoint FROM nibrun.app_configs c
     JOIN nibrun.apps a ON a.id = c.app_id
     WHERE a.id = $1 AND a.owner_id = $2 ORDER BY c.id DESC LIMIT 1`,
    [appId, OWNER_ID],
  );
  expect(current.id).toBe(job.source_config_id);
  expect(current.volume_storage_endpoint).toBeNull();
  const [stored] = await sql.unsafe(
    `SELECT m.volume_storage_secret_access_key, m.volume_storage_session_token,
            m.volume_storage_encryption_password
     FROM nibrun.volume_storage_migrations m JOIN nibrun.apps a ON a.id = m.app_id
     WHERE m.id = $1 AND a.owner_id = $2`,
    [job.id, OWNER_ID],
  );
  expect(stored.volume_storage_encryption_password).toBe(target.volume_storage_encryption_password);
  expect(
    openSecret({ key: TEST_SECRETS_KEY, sealed: stored.volume_storage_encryption_password }),
  ).toBe('filesystem-password');
  expect(stored.volume_storage_secret_access_key).toBe(target.volume_storage_secret_access_key);
  expect(stored.volume_storage_session_token).toBe(target.volume_storage_session_token);
  expect(await repository().findById({ appId, ownerId: OWNER_ID, migrationId: job.id })).toEqual(
    job,
  );
  expect(
    await repository().findById({ appId, ownerId: OTHER_OWNER_ID, migrationId: job.id }),
  ).toBeNull();
});

test('concurrent requests retain one pending destination and retries get fresh prefixes', async () => {
  const appId = await createApp({ name: 'concurrent', deployed: true, configured: false });
  const input = { appId, ownerId: OWNER_ID, destination: destination(ACCESS_KEY_AUTH) };
  const [first, second] = await Promise.all([
    repository().request(input),
    repository().request(input),
  ]);
  expect(first).not.toBeNull();
  expect(second).toEqual(first);
  const changed = await repository().request({
    ...input,
    destination: { ...input.destination, volume_storage_bucket: 'another-bucket' },
  });
  expect(changed).toEqual(first);
  await sql.unsafe(
    `UPDATE nibrun.volume_storage_migrations m SET state = 'failed', message = 'retry'
     FROM nibrun.apps a WHERE m.app_id = a.id AND m.id = $1 AND a.owner_id = $2`,
    [first!.id, OWNER_ID],
  );
  const retry = await repository().request(input);
  expect(retry).not.toBeNull();
  expect(retry!.id).not.toBe(first!.id);
  expect(retry!.volume_storage_prefix).not.toBe(first!.volume_storage_prefix);
});

test('unowned, undeployed and configured apps cannot queue a migration', async () => {
  const target = destination(ACCESS_KEY_AUTH);
  const owned = await createApp({ name: 'owned', deployed: true, configured: false });
  expect(
    await repository().request({ appId: owned, ownerId: OTHER_OWNER_ID, destination: target }),
  ).toBeNull();
  for (const fixture of [
    { name: 'undeployed', deployed: false, configured: false },
    { name: 'configured', deployed: true, configured: true },
  ]) {
    const appId = await createApp(fixture);
    expect(
      await repository().request({ appId, ownerId: OWNER_ID, destination: target }),
    ).toBeNull();
  }
});

test('incomplete auth and empty destination credentials are rejected by the database', async () => {
  const appId = await createApp({ name: 'invalid', deployed: true, configured: false });
  const valid = destination(ACCESS_KEY_AUTH);
  for (const target of [
    { ...valid, volume_storage_auth_kind: 'session' as const },
    { ...valid, volume_storage_auth_kind: 'anonymous' as const },
    { ...valid, volume_storage_secret_access_key: null },
    { ...valid, volume_storage_region: '' },
    { ...valid, volume_storage_bucket: '' },
  ]) {
    await expect(
      repository().request({ appId, ownerId: OWNER_ID, destination: target }),
    ).rejects.toMatchObject({ errno: '23514' });
  }
});

async function createApp({
  name,
  deployed,
  configured,
}: {
  name: string;
  deployed: boolean;
  configured: boolean;
}) {
  const [app] = await sql.unsafe(
    'INSERT INTO nibrun.apps (owner_id, name, slug) VALUES ($1, $2, $2) RETURNING id',
    [OWNER_ID, name],
  );
  const [config] = await sql.unsafe(
    `INSERT INTO nibrun.app_configs (
       app_id, http_port, args, vcpu_count, memory_mib,
       health_check_interval_ms, health_check_timeout_ms, health_check_grace_period_ms,
       health_check_healthy_threshold, health_check_unhealthy_threshold,
       restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
       restart_backoff_factor, restart_reset_after_ms,
       volume_storage_endpoint, volume_storage_bucket, volume_storage_prefix,
       volume_storage_auth_kind, volume_storage_encryption_password)
     VALUES ($1, 8080, '{}'::text[], 1, 512, 1000, 1000, 1000, 1, 3, 5, 500, 5000, 2, 60000,
             $2, $3, $4, $5, $6) RETURNING id`,
    [
      app.id,
      configured ? 'https://existing.example.test' : null,
      configured ? 'existing-bucket' : null,
      configured ? 'existing/' : null,
      configured ? 'anonymous' : null,
      configured ? sealed('existing-password') : null,
    ],
  );
  if (deployed) {
    const [artifact] = await sql.unsafe(
      `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
       VALUES ($1, 'sha256:test', 1, 'artifacts/test', 'app') RETURNING id`,
      [app.id],
    );
    await sql.unsafe(
      `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, state)
       VALUES ($1, $2, $3, 'running')`,
      [app.id, artifact.id, config.id],
    );
  }
  return Value.Parse(AppIdSchema, app.id);
}
