import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { DEFAULT_VOLUME_SIZE_BYTES } from '@repo/api-constants';
import {
  AppIdSchema,
  DeploymentIdSchema,
  type HostId,
  HttpPortSchema,
  type S3VolumeAuth,
  type S3VolumeStorage,
  S3VolumeStorageSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import { type Queries, schema } from '#db/queries.gen.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { openSecret, sealSecret } from '#lib/tenant-secrets.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { registerHost } from '#tests/support/hosts.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const SHARED_APP = 'shared';
const PRIVATE_APP = 'private';
let HOST_ID: HostId;
const OWNER_ID = Value.Parse(OwnerIdSchema, 'owner');
const PREVIOUS_HTTP_PORT = 8181;
const ACCESS_KEY_AUTH = Value.Parse(S3VolumeStorageSchema.properties.auth, {
  kind: 'access-key',
  accessKeyId: 'access',
  secretAccessKey: 'secret',
});
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  HOST_ID = await registerHost({ sql, originId: 'storage-test-host' });
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('owner', 'owner', 'owner@example.test', true, now(), now())`,
  );
  await createApp(SHARED_APP);
  await insertConfig({ slug: SHARED_APP, storage: undefined });
  await deployApp(SHARED_APP);
  await createApp(PRIVATE_APP);
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

async function desiredVolumes() {
  const repository = new AgentRepository({
    sql: withTypes<Queries>(sql),
    secretsKey: TEST_SECRETS_KEY,
  });
  return (await repository.desiredState({ hostId: HOST_ID })).volumes;
}

function storage(auth: S3VolumeAuth) {
  return Value.Parse(S3VolumeStorageSchema, {
    endpoint: 'https://objects.example.test',
    bucket: 'customer-bucket',
    prefix: `apps/${auth.kind}/`,
    auth,
    encryptionPassword: 'filesystem-password',
  });
}

async function storedColumns(slug = PRIVATE_APP) {
  const [row] = await sql.unsafe(
    `SELECT volume_storage_endpoint, volume_storage_bucket, volume_storage_prefix,
            volume_storage_region, volume_storage_auth_kind, volume_storage_access_key_id,
            volume_storage_secret_access_key, volume_storage_session_token,
            volume_storage_encryption_password
     FROM nibrun.app_configs c JOIN nibrun.apps a ON a.id = c.app_id
     WHERE a.slug = $1 AND a.owner_id = $2 ORDER BY c.id DESC LIMIT 1`,
    [slug, OWNER_ID],
  );
  return row;
}

test('without storage columns, the existing volume response is unchanged', async () => {
  const [app] = await sql.unsafe('SELECT id FROM nibrun.apps WHERE slug = $1', [SHARED_APP]);
  expect(await desiredVolumes()).toEqual([
    {
      volumeId: app.id,
      appId: app.id,
      sizeBytes: DEFAULT_VOLUME_SIZE_BYTES,
      desiredState: 'present',
    },
  ]);
});

test('a config row stores ordinary fields as columns and seals each credential separately', async () => {
  await insertConfig({ slug: PRIVATE_APP, storage: storage(ACCESS_KEY_AUTH) });
  expect(await desiredVolumes()).toHaveLength(1);
  await deployApp(PRIVATE_APP);
  const volumes = await desiredVolumes();
  expect(volumes).toHaveLength(2);
  expect(volumes.filter((volume) => 'storage' in volume)).toHaveLength(1);
  expect(volumes.find((volume) => volume.storage)?.storage).toEqual(storage(ACCESS_KEY_AUTH));
  expect(volumes.find((volume) => volume.storage)?.storage).not.toHaveProperty('region');
  const row = await storedColumns();
  expect(row).toMatchObject({
    volume_storage_endpoint: 'https://objects.example.test',
    volume_storage_bucket: 'customer-bucket',
    volume_storage_auth_kind: 'access-key',
    volume_storage_access_key_id: 'access',
    volume_storage_region: null,
    volume_storage_session_token: null,
  });
  for (const [column, plaintext] of [
    ['volume_storage_secret_access_key', 'secret'],
    ['volume_storage_encryption_password', 'filesystem-password'],
  ] as const) {
    expect(row[column]).not.toBe(plaintext);
    expect(openSecret({ key: TEST_SECRETS_KEY, sealed: row[column] })).toBe(plaintext);
  }
});

test('normal config edits and subsequent deployments preserve storage without exposing its columns', async () => {
  const previous = await storedColumns();
  const [app] = await sql.unsafe('SELECT id FROM nibrun.apps WHERE slug = $1', [PRIVATE_APP]);
  const changed = await new AppsRepository(withTypes<Queries>(sql)).update({
    appId: Value.Parse(AppIdSchema, app.id),
    ownerId: OWNER_ID,
    patch: { name: undefined, args: ['changed'] },
  });
  expect(changed?.args).toEqual(['changed']);
  expect(changed).not.toHaveProperty('volume_storage_secret_access_key');
  expect(await storedColumns()).toEqual(previous);
  await deployApp(PRIVATE_APP);
  expect((await desiredVolumes()).find((volume) => volume.storage)?.storage).toEqual(
    storage(ACCESS_KEY_AUTH),
  );
});

test('an undeployed config version does not redirect an existing volume', async () => {
  const appId = await createApp('pinned');
  const original = Value.Parse(S3VolumeStorageSchema, {
    ...storage(ACCESS_KEY_AUTH),
    prefix: 'pinned/original/',
  });
  await insertConfig({ slug: 'pinned', storage: original });
  await deployApp('pinned');
  await insertConfig({
    slug: 'pinned',
    storage: Value.Parse(S3VolumeStorageSchema, { ...original, prefix: 'pinned/not-deployed/' }),
  });
  expect((await desiredVolumes()).find((volume) => volume.appId === appId)?.storage).toEqual(
    original,
  );
});

test('session and anonymous auth travel through the existing protocol unchanged', async () => {
  const variants = [
    Value.Parse(S3VolumeStorageSchema.properties.auth, {
      kind: 'session',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      sessionToken: 'token',
    }),
    { kind: 'anonymous' as const },
  ];
  for (const auth of variants) {
    const appId = await createApp(auth.kind);
    const configured = { ...storage(auth), region: 'custom-region' };
    await insertConfig({ slug: auth.kind, storage: configured });
    await deployApp(auth.kind);
    expect((await desiredVolumes()).find((volume) => volume.appId === appId)?.storage).toEqual(
      configured,
    );
  }
});

test('database constraints reject incomplete storage and auth variants', async () => {
  const configured = storage(ACCESS_KEY_AUTH);
  for (const auth of [
    { kind: 'access-key', accessKeyId: 'access' },
    { kind: 'session', accessKeyId: 'access', secretAccessKey: 'secret' },
    { kind: 'unknown' },
  ]) {
    await expect(
      insertConfig({ slug: PRIVATE_APP, storage: { ...configured, auth } as S3VolumeStorage }),
    ).rejects.toMatchObject({
      errno: '23514',
      constraint:
        schema.app_configs._constraints.app_configs_volume_storage_auth_check._constraintName,
    });
  }
  await expect(
    insertConfig({
      slug: PRIVATE_APP,
      storage: { ...configured, bucket: undefined } as unknown as S3VolumeStorage,
    }),
  ).rejects.toMatchObject({
    errno: '23514',
    constraint:
      schema.app_configs._constraints.app_configs_volume_storage_target_check._constraintName,
  });
});

test('deletion retains the deployment’s storage even after every release is superseded', async () => {
  const [app] = await sql.unsafe('SELECT id FROM nibrun.apps WHERE slug = $1', [PRIVATE_APP]);
  await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleting' WHERE id = $1`, [app.id]);
  await sql.unsafe(`UPDATE nibrun.deployments SET state = 'superseded' WHERE app_id = $1`, [
    app.id,
  ]);
  expect((await desiredVolumes()).find((volume) => volume.appId === app.id)).toMatchObject({
    desiredState: 'absent',
    storage: storage(ACCESS_KEY_AUTH),
  });
  await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1`, [app.id]);
  expect((await desiredVolumes()).some((volume) => volume.appId === app.id)).toBe(false);
});

test.each([
  ACCESS_KEY_AUTH,
  Value.Parse(S3VolumeStorageSchema.properties.auth, {
    kind: 'session',
    accessKeyId: 'new-access',
    secretAccessKey: 'new-secret',
    sessionToken: 'new-token',
  }),
  { kind: 'anonymous' as const },
])(
  'rollback restores the old release while preserving current $kind volume storage',
  async (auth) => {
    const slug = `rollback-${auth.kind}`;
    const appId = Value.Parse(AppIdSchema, await createApp(slug));
    const apps = new AppsRepository(withTypes<Queries>(sql));
    const deployments = new DeploymentsRepository(withTypes<Queries>(sql));
    await insertConfig({ slug, storage: undefined });
    const previousSecret = sealSecret({ key: TEST_SECRETS_KEY, plaintext: 'previous-environment' });
    await apps.update({
      appId,
      ownerId: OWNER_ID,
      patch: {
        name: undefined,
        httpPort: Value.Parse(HttpPortSchema, PREVIOUS_HTTP_PORT),
        args: ['previous'],
        environment: { set: { TOKEN: previousSecret }, removed: [] },
      },
    });
    const previous = await deployApp(slug);
    await sql.unsafe(
      `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
     SELECT id, 'sha256:new', 1, 'artifacts/new', 'new-app'
     FROM nibrun.apps WHERE id = $1 AND owner_id = $2`,
      [appId, OWNER_ID],
    );
    const configured = { ...storage(auth), region: 'auto' };
    await insertConfig({ slug, storage: configured });
    const current = await deployApp(slug);
    const currentColumns = await storedColumns(slug);
    const volume = (await desiredVolumes()).find((one) => one.appId === appId);
    await insertConfig({ slug, storage: { ...configured, bucket: 'not-deployed' } });
    const request = {
      appId,
      ownerId: OWNER_ID,
      rollbackOf: Value.Parse(DeploymentIdSchema, previous.id),
    };
    expect(
      await deployments.insertRollback({
        ...request,
        ownerId: Value.Parse(OwnerIdSchema, 'another-owner'),
      }),
    ).toBeNull();
    expect(
      (
        await deployments.findById({
          appId,
          ownerId: OWNER_ID,
          deploymentId: Value.Parse(DeploymentIdSchema, current.id),
        })
      )?.state,
    ).toBe('running');
    const rollback = await deployments.insertRollback(request);
    expect(rollback).toMatchObject({
      artifact_id: previous.artifact_id,
      rollback_of_deployment_id: previous.id,
      http_port: PREVIOUS_HTTP_PORT,
      args: ['previous'],
      environment_names: ['TOKEN'],
    });
    expect(rollback?.artifact_id).not.toBe(current.artifact_id);
    expect(await storedColumns(slug)).toEqual(currentColumns);
    expect((await desiredVolumes()).find((one) => one.appId === appId)).toEqual(volume);
    const environment = await sql.unsafe(
      `SELECT e.name, e.value FROM nibrun.app_config_environment e
     JOIN nibrun.deployments d ON d.config_id = e.config_id
     JOIN nibrun.apps a ON a.id = d.app_id
     WHERE d.id = $1 AND a.id = $2 AND a.owner_id = $3`,
      [rollback!.id, appId, OWNER_ID],
    );
    expect([...environment]).toEqual([{ name: 'TOKEN', value: previousSecret }]);
  },
);

test.each([
  { name: 'shared', configured: undefined },
  { name: 'configured', configured: storage(ACCESS_KEY_AUTH) },
])('matching $name storage reuses the original rollback config', async ({ name, configured }) => {
  const slug = `rollback-same-${name}`;
  const appId = Value.Parse(AppIdSchema, await createApp(slug));
  await insertConfig({ slug, storage: configured });
  const previous = await deployApp(slug);
  await new AppsRepository(withTypes<Queries>(sql)).update({
    appId,
    ownerId: OWNER_ID,
    patch: { name: undefined, args: ['newer'] },
  });
  await deployApp(slug);
  const volume = (await desiredVolumes()).find((one) => one.appId === appId);
  const [before] = await sql.unsafe(
    'SELECT count(*) FROM nibrun.app_configs c JOIN nibrun.apps a ON a.id = c.app_id WHERE a.id = $1 AND a.owner_id = $2',
    [appId, OWNER_ID],
  );
  const rollback = await new DeploymentsRepository(withTypes<Queries>(sql)).insertRollback({
    appId,
    ownerId: OWNER_ID,
    rollbackOf: Value.Parse(DeploymentIdSchema, previous.id),
  });
  const [selected] = await sql.unsafe(
    'SELECT d.config_id FROM nibrun.deployments d JOIN nibrun.apps a ON a.id = d.app_id WHERE d.id = $1 AND a.id = $2 AND a.owner_id = $3',
    [rollback!.id, appId, OWNER_ID],
  );
  const [after] = await sql.unsafe(
    'SELECT count(*) FROM nibrun.app_configs c JOIN nibrun.apps a ON a.id = c.app_id WHERE a.id = $1 AND a.owner_id = $2',
    [appId, OWNER_ID],
  );
  expect(selected.config_id).toBe(previous.config_id);
  expect(after.count).toBe(before.count);
  expect(rollback?.args).toEqual([]);
  expect((await desiredVolumes()).find((one) => one.appId === appId)).toEqual(volume);
});

async function createApp(slug: string) {
  const [app] = await sql.unsafe(
    `INSERT INTO nibrun.apps (owner_id, name, slug) VALUES ('owner', $1, $1) RETURNING id`,
    [slug],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
     VALUES ($1, 'sha256:artifact', 1, 'artifacts/test', 'app')`,
    [app.id],
  );
  return app.id;
}

function sealed(value: string | undefined) {
  return value === undefined ? null : sealSecret({ key: TEST_SECRETS_KEY, plaintext: value });
}

async function insertConfig({
  slug,
  storage: configured,
}: {
  slug: string;
  storage: S3VolumeStorage | undefined;
}) {
  const auth = configured?.auth;
  const credentials = auth?.kind === 'anonymous' ? undefined : auth;
  await sql.unsafe(
    `INSERT INTO nibrun.app_configs (
       app_id, http_port, args, vcpu_count, memory_mib,
       health_check_interval_ms, health_check_timeout_ms, health_check_grace_period_ms,
       health_check_healthy_threshold, health_check_unhealthy_threshold,
       restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
       restart_backoff_factor, restart_reset_after_ms,
       volume_storage_endpoint, volume_storage_bucket, volume_storage_prefix,
       volume_storage_region, volume_storage_auth_kind, volume_storage_access_key_id,
       volume_storage_secret_access_key, volume_storage_session_token, volume_storage_encryption_password)
     SELECT id, 8080, '{}'::text[], 1, 512, 1000, 1000, 1000, 1, 3, 5, 500, 5000, 2, 60000,
            $2, $3, $4, $5, $6, $7, $8, $9, $10
     FROM nibrun.apps WHERE slug = $1`,
    [
      slug,
      configured?.endpoint ?? null,
      configured?.bucket ?? null,
      configured?.prefix ?? null,
      configured?.region ?? null,
      auth?.kind ?? null,
      credentials?.accessKeyId ?? null,
      sealed(credentials?.secretAccessKey),
      sealed(auth?.kind === 'session' ? auth.sessionToken : undefined),
      sealed(configured?.encryptionPassword),
    ],
  );
}

async function deployApp(slug: string) {
  await sql.unsafe(
    `UPDATE nibrun.deployments d SET state = 'superseded'
     FROM nibrun.apps a WHERE d.app_id = a.id AND a.slug = $1`,
    [slug],
  );
  const [deployment] = await sql.unsafe(
    `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, state, host_id)
     SELECT a.id, ar.id, c.id, 'running', $2
     FROM nibrun.apps a
     JOIN LATERAL (
       SELECT id FROM nibrun.artifacts ar WHERE ar.app_id = a.id ORDER BY ar.id DESC LIMIT 1
     ) ar ON true
     JOIN LATERAL (SELECT id FROM nibrun.app_configs c WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1) c ON true
     WHERE a.slug = $1
     RETURNING id, config_id, artifact_id`,
    [slug, HOST_ID],
  );
  return deployment;
}
