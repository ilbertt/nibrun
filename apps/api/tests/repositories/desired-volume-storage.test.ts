import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { DEFAULT_VOLUME_SIZE_BYTES } from '@repo/api-constants';
import { HostIdSchema, type S3VolumeAuth, S3VolumeStorageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import { type Queries, schema } from '#db/queries.gen.ts';
import { sealVolumeStorage } from '#lib/volume-storage.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const SHARED_APP = 'shared';
const PRIVATE_APP = 'private';
const HOST_ID = Value.Parse(HostIdSchema, 'storage-test-host');
const AUTH_VARIANTS: S3VolumeAuth[] = [
  Value.Parse(S3VolumeStorageSchema.properties.auth, {
    kind: 'access-key',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
  }),
  Value.Parse(S3VolumeStorageSchema.properties.auth, {
    kind: 'session',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    sessionToken: 'token',
  }),
  { kind: 'anonymous' },
];
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ('owner', 'owner', 'owner@example.test', true, now(), now())`,
  );
  await createApp(SHARED_APP);
  await deployApp(SHARED_APP);
  await createApp(PRIVATE_APP);
}, DATABASE_START_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_START_TIMEOUT_MS);

async function desiredVolumes() {
  return (
    await new AgentRepository({
      sql: withTypes<Queries>(sql),
      secretsKey: TEST_SECRETS_KEY,
    }).desiredState({ hostId: HOST_ID })
  ).volumes;
}

function storage(auth: S3VolumeAuth) {
  return Value.Parse(S3VolumeStorageSchema, {
    endpoint: 'https://objects.example.test',
    bucket: 'customer-bucket',
    prefix: 'private-app/',
    auth,
    encryptionPassword: 'filesystem-password',
  });
}

async function configureApp({ slug, auth }: { slug: string; auth: S3VolumeAuth }) {
  const sealed = sealVolumeStorage({ key: TEST_SECRETS_KEY, storage: storage(auth) });
  await sql.unsafe(
    `INSERT INTO nibrun.app_volume_storage (app_id, configuration)
     SELECT id, $2 FROM nibrun.apps WHERE slug = $1`,
    [slug, sealed],
  );
  return sealed;
}

test('without a storage row, the existing volume response is unchanged', async () => {
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

test('a database row enables configured storage on the first deployment only for that app', async () => {
  const sealed = await configureApp({ slug: PRIVATE_APP, auth: AUTH_VARIANTS[0]! });
  expect(await desiredVolumes()).toHaveLength(1);
  await deployApp(PRIVATE_APP);
  const volumes = await desiredVolumes();
  expect(volumes).toHaveLength(2);
  expect(volumes.filter((volume) => 'storage' in volume)).toHaveLength(1);
  expect(volumes.find((volume) => volume.storage)?.storage).toEqual(storage(AUTH_VARIANTS[0]!));
  expect(volumes.find((volume) => volume.storage)?.storage).not.toHaveProperty('region');
  const [stored] = await sql.unsafe('SELECT configuration FROM nibrun.app_volume_storage');
  expect(stored.configuration).toBe(sealed);
  for (const secret of ['customer-bucket', 'filesystem-password', 'secret']) {
    expect(stored.configuration).not.toContain(secret);
  }
});

test('session and anonymous auth travel through the existing protocol unchanged', async () => {
  for (const auth of AUTH_VARIANTS.slice(1)) {
    const slug = auth.kind;
    await createApp(slug);
    await configureApp({ slug, auth });
    await deployApp(slug);
    expect((await desiredVolumes()).some((volume) => volume.storage?.auth.kind === auth.kind)).toBe(
      true,
    );
  }
});

test('one lifetime configuration per app cannot be overwritten or removed', async () => {
  await expect(configureApp({ slug: PRIVATE_APP, auth: AUTH_VARIANTS[0]! })).rejects.toMatchObject({
    errno: '23505',
    constraint:
      schema.app_volume_storage._constraints.app_volume_storage_app_id_key._constraintName,
  });
  for (const statement of [
    'UPDATE nibrun.app_volume_storage SET configuration = configuration',
    'DELETE FROM nibrun.app_volume_storage',
  ]) {
    await expect(sql.unsafe(statement).execute()).rejects.toMatchObject({ errno: 'P0001' });
  }
});

test('deletion keeps the customer storage identity until the filesystem is gone', async () => {
  await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleting' WHERE slug = $1`, [PRIVATE_APP]);
  expect(
    (await desiredVolumes()).find((volume) => volume.storage?.auth.kind === 'access-key'),
  ).toMatchObject({
    desiredState: 'absent',
    storage: storage(AUTH_VARIANTS[0]!),
  });
  await sql.unsafe(`UPDATE nibrun.apps SET state = 'deleted' WHERE slug = $1`, [PRIVATE_APP]);
  expect(
    (await desiredVolumes()).some((volume) => volume.storage?.auth.kind === 'access-key'),
  ).toBe(false);
});

async function createApp(slug: string) {
  await sql.unsafe(`INSERT INTO nibrun.apps (owner_id, name, slug) VALUES ('owner', $1, $1)`, [
    slug,
  ]);
}

async function deployApp(slug: string) {
  await sql.unsafe(
    `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
     SELECT id, 'sha256:artifact', 1, 'artifacts/test', 'app' FROM nibrun.apps WHERE slug = $1`,
    [slug],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.app_configs (
       app_id, http_port, args, vcpu_count, memory_mib,
       health_check_interval_ms, health_check_timeout_ms, health_check_grace_period_ms,
       health_check_healthy_threshold, health_check_unhealthy_threshold,
       restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
       restart_backoff_factor, restart_reset_after_ms)
     SELECT id, 8080, '{}'::text[], 1, 512, 1000, 1000, 1000, 1, 3, 5, 500, 5000, 2, 60000
     FROM nibrun.apps WHERE slug = $1`,
    [slug],
  );
  await sql.unsafe(
    `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, state)
     SELECT a.id, ar.id, c.id, 'running'
     FROM nibrun.apps a
     JOIN nibrun.artifacts ar ON ar.app_id = a.id
     JOIN nibrun.app_configs c ON c.app_id = a.id
     WHERE a.slug = $1`,
    [slug],
  );
}
