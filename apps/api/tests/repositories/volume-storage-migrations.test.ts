import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import {
  AppIdSchema,
  DeploymentIdSchema,
  type HostId,
  type S3VolumeAuth,
  S3VolumeAuthSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { ArtifactIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';
import { ConflictError } from '#lib/errors.ts';
import { openSecret, sealSecret } from '#lib/tenant-secrets.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { ExportsRepository } from '#repositories/exports.repository.ts';
import {
  type VolumeStorageMigrationDestination,
  VolumeStorageMigrationsRepository,
} from '#repositories/volume-storage-migrations.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { registerHost } from '#tests/support/hosts.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const EXPORT_RETENTION_MS = 86_400_000;
const OWNER_ID = Value.Parse(OwnerIdSchema, 'migration-owner');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'migration-other');
let HOST_ID: HostId;
let OTHER_HOST_ID: HostId;
const ACCESS_KEY_AUTH = Value.Parse(S3VolumeAuthSchema, {
  kind: 'access-key',
  accessKeyId: 'test-access',
  secretAccessKey: 'test-secret',
});
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
  HOST_ID = await registerHost({ sql, originId: 'migration-host' });
  OTHER_HOST_ID = await registerHost({ sql, originId: 'migration-other-host' });
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
])(
  'a pending $kind destination uses app_configs while the deployed volume stays unchanged',
  async (auth) => {
    const appId = await createApp({ name: auth.kind, deployed: true, configured: false });
    const environment = { TOKEN: sealed('original-environment') };
    await new AppsRepository(withTypes<Queries>(sql)).update({
      appId,
      ownerId: OWNER_ID,
      patch: { name: undefined, args: ['serve'], environment: { set: environment, removed: [] } },
    });
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
    const apps = new AppsRepository(withTypes<Queries>(sql));
    const status = {
      id: appId,
      config_id: job.config_id,
      volume_storage_migration_state: 'pending',
      volume_storage_migration_started_at: null,
    };
    expect(await apps.findById({ appId, ownerId: OWNER_ID })).toMatchObject(status);
    expect(await apps.listByOwner({ ownerId: OWNER_ID })).toContainEqual(
      expect.objectContaining(status),
    );
    expect(String(job.volume_storage_prefix).startsWith(`apps/${appId}/`)).toBe(true);
    expect(job).not.toHaveProperty('volume_storage_access_key_id');
    expect(job).not.toHaveProperty('volume_storage_secret_access_key');
    expect(job).not.toHaveProperty('volume_storage_session_token');
    expect(job).not.toHaveProperty('volume_storage_encryption_password');
    expect(await desiredVolumes()).toEqual(before);
    const [current] = await sql.unsafe(
      `SELECT c.id, c.args, c.volume_storage_endpoint FROM nibrun.app_configs c
     JOIN nibrun.apps a ON a.id = c.app_id
     WHERE a.id = $1 AND a.owner_id = $2 ORDER BY c.id DESC LIMIT 1`,
      [appId, OWNER_ID],
    );
    expect(current.id).toBe(job.config_id);
    expect(current.volume_storage_endpoint).toBe(target.volume_storage_endpoint);
    expect(current.args).toEqual(['serve']);
    const variables = await sql.unsafe(
      'SELECT e.name, e.value FROM nibrun.app_config_environment e JOIN nibrun.app_configs c ON c.id = e.config_id JOIN nibrun.apps a ON a.id = c.app_id WHERE e.config_id = $1 AND a.owner_id = $2',
      [job.config_id, OWNER_ID],
    );
    expect([...variables]).toEqual([{ name: 'TOKEN', value: environment.TOKEN }]);
    const [stored] = await sql.unsafe(
      `SELECT m.volume_storage_secret_access_key, m.volume_storage_session_token,
            m.volume_storage_encryption_password
     FROM nibrun.app_configs m JOIN nibrun.apps a ON a.id = m.app_id
     WHERE m.id = $1 AND a.owner_id = $2`,
      [job.config_id, OWNER_ID],
    );
    expect(stored.volume_storage_encryption_password).toBe(
      target.volume_storage_encryption_password,
    );
    expect(
      openSecret({ key: TEST_SECRETS_KEY, sealed: stored.volume_storage_encryption_password }),
    ).toBe('filesystem-password');
    expect(stored.volume_storage_secret_access_key).toBe(target.volume_storage_secret_access_key);
    expect(stored.volume_storage_session_token).toBe(target.volume_storage_session_token);
    expect(await repository().findByApp({ appId, ownerId: OWNER_ID })).toEqual(job);
    expect(await repository().findByApp({ appId, ownerId: OTHER_OWNER_ID })).toBeNull();
  },
);

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
  expect(
    await repository().abort({
      appId,
      ownerId: OWNER_ID,
      configId: first!.config_id,
      state: 'failed',
      message: 'retry',
    }),
  ).toBe(true);
  expect(await repository().findByApp({ appId, ownerId: OWNER_ID })).toMatchObject({
    state: 'failed',
    message: 'retry',
    volume_storage_endpoint: null,
  });
  const retry = await repository().request(input);
  expect(retry).not.toBeNull();
  expect(retry!.config_id).not.toBe(first!.config_id);
  expect(retry!.volume_storage_prefix).not.toBe(first!.volume_storage_prefix);
  expect(
    await repository().abort({
      appId,
      ownerId: OWNER_ID,
      configId: first!.config_id,
      state: 'cancelled',
      message: null,
    }),
  ).toBe(false);
});

test('pending migration blocks config edits, deployments, rollbacks and deletion until cancelled', async () => {
  const appId = await createApp({ name: 'guarded', deployed: true, configured: false });
  const apps = new AppsRepository(withTypes<Queries>(sql));
  const deployments = new DeploymentsRepository(withTypes<Queries>(sql));
  const [previous] = await sql.unsafe(
    'SELECT d.id, d.artifact_id FROM nibrun.deployments d JOIN nibrun.apps a ON a.id = d.app_id WHERE a.id = $1 AND a.owner_id = $2 ORDER BY d.id DESC LIMIT 1',
    [appId, OWNER_ID],
  );
  const artifactId = Value.Parse(ArtifactIdSchema, previous.artifact_id);
  const migration = await repository().request({
    appId,
    ownerId: OWNER_ID,
    destination: destination(ACCESS_KEY_AUTH),
  });
  const attempts = [
    function edit() {
      return apps.update({
        appId,
        ownerId: OWNER_ID,
        patch: { name: undefined, args: ['edited'] },
      });
    },
    function deploy() {
      return deployments.insert({
        appId,
        ownerId: OWNER_ID,
        artifactId,
        initialDataFrom: null,
        onlyOne: false,
      });
    },
    function rollback() {
      return deployments.insertRollback({
        appId,
        ownerId: OWNER_ID,
        rollbackOf: Value.Parse(DeploymentIdSchema, previous.id),
      });
    },
    function remove() {
      return apps.updateState({
        appId,
        ownerId: OWNER_ID,
        state: 'deleting',
        from: ['active', 'suspended'],
      });
    },
  ];
  for (const attempt of attempts) {
    await expect(attempt()).rejects.toBeInstanceOf(ConflictError);
  }
  expect(
    await repository().abort({
      appId,
      ownerId: OTHER_OWNER_ID,
      configId: migration!.config_id,
      state: 'cancelled',
      message: null,
    }),
  ).toBe(false);
  expect(
    await repository().abort({
      appId,
      ownerId: OWNER_ID,
      configId: migration!.config_id,
      state: 'cancelled',
      message: null,
    }),
  ).toBe(true);
  expect(await repository().findByApp({ appId, ownerId: OWNER_ID })).toMatchObject({
    state: 'cancelled',
    volume_storage_endpoint: null,
    volume_storage_bucket: null,
  });
  expect(
    (
      await apps.update({
        appId,
        ownerId: OWNER_ID,
        patch: { name: undefined, args: ['after-cancel'] },
      })
    )?.args,
  ).toEqual(['after-cancel']);
  expect(
    (
      await deployments.insert({
        appId,
        ownerId: OWNER_ID,
        artifactId,
        initialDataFrom: null,
        onlyOne: false,
      })
    ).outcome,
  ).toBe('created');
  expect((await desiredVolumes()).find((volume) => volume.appId === appId)).not.toHaveProperty(
    'storage',
  );
});

test('a deployment racing with migration cannot select the pending destination', async () => {
  const appId = await createApp({ name: 'deployment-race', deployed: true, configured: false });
  const [previous] = await sql.unsafe(
    'SELECT d.artifact_id FROM nibrun.deployments d JOIN nibrun.apps a ON a.id = d.app_id WHERE a.id = $1 AND a.owner_id = $2 ORDER BY d.id DESC LIMIT 1',
    [appId, OWNER_ID],
  );
  const [migration, deployment] = await Promise.allSettled([
    repository().request({ appId, ownerId: OWNER_ID, destination: destination(ACCESS_KEY_AUTH) }),
    new DeploymentsRepository(withTypes<Queries>(sql)).insert({
      appId,
      ownerId: OWNER_ID,
      artifactId: Value.Parse(ArtifactIdSchema, previous.artifact_id),
      initialDataFrom: null,
      onlyOne: false,
    }),
  ]);
  expect(migration).toMatchObject({ status: 'fulfilled', value: { state: 'pending' } });
  if (deployment.status === 'rejected') {
    expect(deployment.reason).toBeInstanceOf(ConflictError);
  } else {
    expect(deployment.value.outcome).toBe('created');
  }
  expect((await desiredVolumes()).find((volume) => volume.appId === appId)).not.toHaveProperty(
    'storage',
  );
});

test('only the owning started attempt can switch storage and concurrent retries reuse one deployment', async () => {
  const appId = await createApp({ name: 'atomic-cutover', deployed: true, configured: false });
  await sql.unsafe('UPDATE nibrun.deployments SET host_id = $1 WHERE app_id = $2', [
    HOST_ID,
    appId,
  ]);
  const owned = { appId, ownerId: OWNER_ID };
  const deployments = new DeploymentsRepository(withTypes<Queries>(sql));
  const before = await deployments.listByApp(owned);
  const volumes = await desiredVolumes();
  const migration = await repository().request({
    ...owned,
    destination: destination(ACCESS_KEY_AUTH),
  });
  const attempt = { ...owned, configId: migration!.config_id, hostId: HOST_ID };
  expect(await repository().cutover(attempt)).toBeNull();
  expect(await repository().start(attempt)).toBe(true);
  expect(await repository().cutover({ ...attempt, hostId: OTHER_HOST_ID })).toBeNull();
  expect(await repository().cutover({ ...attempt, ownerId: OTHER_OWNER_ID })).toBeNull();
  expect(await repository().cutover({ ...attempt, configId: crypto.randomUUID() })).toBeNull();
  expect(await deployments.listByApp(owned)).toEqual(before);
  expect(await desiredVolumes()).toEqual(volumes);
  const [first, retry] = await Promise.all([
    repository().cutover(attempt),
    repository().cutover(attempt),
  ]);
  expect(first).not.toBeNull();
  expect(retry).toBe(first);
  const [placed] = await sql.unsafe('SELECT host_id FROM nibrun.deployments WHERE id = $1', [
    first,
  ]);
  expect(placed.host_id).toBe(HOST_ID);
  const after = await deployments.listByApp(owned);
  expect(after).toHaveLength(2);
  expect(after.find((deployment) => deployment.id === first)).toMatchObject({
    artifact_id: before[0]!.artifact_id,
    state: 'pending',
  });
  expect(after.find((deployment) => deployment.id === before[0]!.id)?.state).toBe('superseded');
  expect((await desiredVolumes()).find((volume) => volume.appId === appId)?.storage).toMatchObject({
    bucket: 'customer-data',
    prefix: migration!.volume_storage_prefix,
  });
  expect((await repository().findByApp(owned))?.state).toBe('pending');
  expect(await repository().complete(attempt)).toBe(true);
  expect(await repository().cutover(attempt)).toBe(first);
  expect(await deployments.listByApp(owned)).toEqual(after);
});

test('host recovery cannot return to shared storage after the destination was deployed', async () => {
  const appId = await createApp({ name: 'cutover', deployed: true, configured: false });
  const migration = await repository().request({
    appId,
    ownerId: OWNER_ID,
    destination: destination(ACCESS_KEY_AUTH),
  });
  expect(
    await repository().start({
      appId,
      ownerId: OWNER_ID,
      configId: migration!.config_id,
      hostId: HOST_ID,
    }),
  ).toBe(true);
  expect(
    await repository().cutover({
      appId,
      ownerId: OWNER_ID,
      configId: migration!.config_id,
      hostId: HOST_ID,
    }),
  ).not.toBeNull();
  expect(
    await repository().abortStarted({
      appId,
      ownerId: OWNER_ID,
      configId: migration!.config_id,
      hostId: HOST_ID,
      state: 'failed',
      message: 'failed after cutover',
    }),
  ).toBe(false);
  expect((await desiredVolumes()).find((volume) => volume.appId === appId)?.storage?.bucket).toBe(
    'customer-data',
  );
});

test('only the owning host can complete a deployed destination, unlocking edits and safe rollback', async () => {
  const appId = await createApp({ name: 'complete-cutover', deployed: true, configured: false });
  const deployments = new DeploymentsRepository(withTypes<Queries>(sql));
  const [source] = await deployments.listByApp({ appId, ownerId: OWNER_ID });
  const migration = await repository().request({
    appId,
    ownerId: OWNER_ID,
    destination: destination(ACCESS_KEY_AUTH),
  });
  const attempt = { appId, ownerId: OWNER_ID, configId: migration!.config_id, hostId: HOST_ID };
  expect(await repository().complete(attempt)).toBe(false);
  expect(await repository().start(attempt)).toBe(true);
  expect(await repository().complete(attempt)).toBe(false);
  expect((await desiredVolumes()).find((volume) => volume.appId === appId)).not.toHaveProperty(
    'storage',
  );
  expect(await repository().cutover(attempt)).not.toBeNull();
  expect(await repository().complete({ ...attempt, hostId: OTHER_HOST_ID })).toBe(false);
  expect(await repository().complete({ ...attempt, ownerId: OTHER_OWNER_ID })).toBe(false);
  expect(await repository().complete({ ...attempt, configId: crypto.randomUUID() })).toBe(false);
  expect((await repository().findByApp(attempt))?.state).toBe('pending');
  const apps = new AppsRepository(withTypes<Queries>(sql));
  const edit = {
    appId,
    ownerId: OWNER_ID,
    patch: { name: undefined, args: ['after-migration'] },
  };
  await expect(apps.update(edit)).rejects.toBeInstanceOf(ConflictError);
  expect(await repository().complete(attempt)).toBe(true);
  const completed = await repository().findByApp(attempt);
  expect(completed).toMatchObject({
    state: 'completed',
    config_id: attempt.configId,
    message: null,
    volume_storage_migration_host_id: HOST_ID,
    volume_storage_migration_started_at: expect.any(Date),
  });
  expect(await repository().complete(attempt)).toBe(true);
  expect(await repository().findByApp(attempt)).toEqual(completed);
  expect(
    await repository().abortStarted({ ...attempt, state: 'failed', message: 'stale failure' }),
  ).toBe(false);
  expect(await apps.update(edit)).not.toBeNull();
  expect(
    await deployments.insertRollback({ appId, ownerId: OWNER_ID, rollbackOf: source!.id }),
  ).not.toBeNull();
  expect((await desiredVolumes()).find((volume) => volume.appId === appId)?.storage).toMatchObject({
    bucket: 'customer-data',
    prefix: migration!.volume_storage_prefix,
  });
  expect(await repository().cutover(attempt)).toBeNull();
});

test('completion cannot release a cancelled attempt or a newer pending migration', async () => {
  const appId = await createApp({
    name: 'complete-stale-attempt',
    deployed: true,
    configured: false,
  });
  const request = { appId, ownerId: OWNER_ID, destination: destination(ACCESS_KEY_AUTH) };
  const first = await repository().request(request);
  const stale = { appId, ownerId: OWNER_ID, configId: first!.config_id, hostId: HOST_ID };
  expect(await repository().start(stale)).toBe(true);
  expect(await repository().abortStarted({ ...stale, state: 'cancelled', message: null })).toBe(
    true,
  );
  expect(await repository().complete(stale)).toBe(false);
  expect(await repository().cutover(stale)).toBeNull();
  const next = await repository().request(request);
  const current = { ...stale, configId: next!.config_id };
  expect(await repository().complete(stale)).toBe(false);
  expect(await repository().complete(current)).toBe(false);
  expect(await repository().start(current)).toBe(true);
  expect(await repository().cutover(stale)).toBeNull();
  expect(await repository().cutover(current)).not.toBeNull();
  expect(await repository().complete(stale)).toBe(false);
  expect((await repository().findByApp(current))?.state).toBe('pending');
  expect(await repository().complete(current)).toBe(true);
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

test('an abandoned unstarted request is restored after repository restart and can be retried', async () => {
  const appId = await createApp({ name: 'unstarted-recovery', deployed: true, configured: false });
  const input = { appId, ownerId: OWNER_ID, destination: destination(ACCESS_KEY_AUTH) };
  const migration = await repository().request(input);
  const createdBefore = new Date(migration!.created_at.getTime() + 1);
  const recovery = {
    appId,
    ownerId: OWNER_ID,
    configId: migration!.config_id,
    createdBefore,
    state: 'failed' as const,
    message: 'Never started.',
  };
  expect(await repository().listUnstarted({ createdBefore, limit: 100 })).toContainEqual({
    app_id: appId,
    owner_id: OWNER_ID,
    config_id: migration!.config_id,
  });
  expect(await repository().abortUnstarted({ ...recovery, ownerId: OTHER_OWNER_ID })).toBe(false);
  expect(await repository().abortUnstarted(recovery)).toBe(true);
  expect(await repository().abortUnstarted(recovery)).toBe(false);
  expect(await repository().findByApp({ appId, ownerId: OWNER_ID })).toMatchObject({
    state: 'failed',
    volume_storage_endpoint: null,
  });
  expect(await repository().start({ ...recovery, hostId: HOST_ID })).toBe(false);
  const retry = await repository().request(input);
  expect(retry!.config_id).not.toBe(migration!.config_id);
  expect(await repository().abortUnstarted(recovery)).toBe(false);
  expect(await repository().start({ ...recovery, hostId: HOST_ID })).toBe(false);
  expect(
    await repository().start({ ...recovery, configId: retry!.config_id, hostId: HOST_ID }),
  ).toBe(true);
});

test('timeout recovery leaves fresh requests and started work blocked', async () => {
  const appId = await createApp({ name: 'started-recovery', deployed: true, configured: false });
  const migration = await repository().request({
    appId,
    ownerId: OWNER_ID,
    destination: destination(ACCESS_KEY_AUTH),
  });
  const attempt = { appId, ownerId: OWNER_ID, configId: migration!.config_id, hostId: HOST_ID };
  const recovery = { ...attempt, state: 'failed' as const, message: 'timeout' };
  expect(
    await repository().abortUnstarted({ ...recovery, createdBefore: migration!.created_at }),
  ).toBe(false);
  const createdBefore = new Date(migration!.created_at.getTime() + 1);
  expect(await repository().start({ ...attempt, ownerId: OTHER_OWNER_ID })).toBe(false);
  expect(await repository().start(attempt)).toBe(true);
  expect(await repository().start(attempt)).toBe(false);
  expect(await repository().listUnstarted({ createdBefore, limit: 100 })).not.toContainEqual({
    app_id: appId,
    owner_id: OWNER_ID,
    config_id: migration!.config_id,
  });
  expect(await repository().abortUnstarted({ ...recovery, createdBefore })).toBe(false);
  await expect(
    new AppsRepository(withTypes<Queries>(sql)).update({
      appId,
      ownerId: OWNER_ID,
      patch: { name: undefined, args: ['unsafe'] },
    }),
  ).rejects.toBeInstanceOf(ConflictError);
});

test('starting and timeout recovery serialize so recovered attempts cannot begin host work', async () => {
  const appId = await createApp({ name: 'start-recovery-race', deployed: true, configured: false });
  const migration = await repository().request({
    appId,
    ownerId: OWNER_ID,
    destination: destination(ACCESS_KEY_AUTH),
  });
  const attempt = { appId, ownerId: OWNER_ID, configId: migration!.config_id, hostId: HOST_ID };
  const [started, recovered] = await Promise.all([
    repository().start(attempt),
    repository().abortUnstarted({
      ...attempt,
      createdBefore: new Date(migration!.created_at.getTime() + 1),
      state: 'failed',
      message: 'timeout',
    }),
  ]);
  expect([started, recovered].filter(Boolean)).toHaveLength(1);
  expect((await repository().findByApp({ appId, ownerId: OWNER_ID }))?.state).toBe(
    recovered ? 'failed' : 'pending',
  );
});

test('started recovery requires the owning host and attempt, including after a repository restart', async () => {
  const appId = await createApp({ name: 'host-owned-recovery', deployed: true, configured: false });
  const request = { appId, ownerId: OWNER_ID, destination: destination(ACCESS_KEY_AUTH) };
  const migration = await repository().request(request);
  const attempt = { appId, ownerId: OWNER_ID, configId: migration!.config_id };
  expect(
    await repository().abortStarted({
      ...attempt,
      hostId: HOST_ID,
      state: 'failed',
      message: null,
    }),
  ).toBe(false);
  const [first, second] = await Promise.all([
    repository().start({ ...attempt, hostId: HOST_ID }),
    repository().start({ ...attempt, hostId: OTHER_HOST_ID }),
  ]);
  expect([first, second].filter(Boolean)).toHaveLength(1);
  const hostId = first ? HOST_ID : OTHER_HOST_ID;
  const otherHostId = first ? OTHER_HOST_ID : HOST_ID;
  expect(await repository().findByApp({ appId, ownerId: OWNER_ID })).toMatchObject({
    volume_storage_migration_host_id: hostId,
    volume_storage_migration_started_at: expect.any(Date),
  });
  const recovery = { ...attempt, state: 'failed' as const, message: 'Host cleanup confirmed.' };
  expect(await repository().abort(recovery)).toBe(false);
  expect(await repository().abortStarted({ ...recovery, hostId: otherHostId })).toBe(false);
  expect(await repository().abortStarted({ ...recovery, hostId, ownerId: OTHER_OWNER_ID })).toBe(
    false,
  );
  await expect(
    new AppsRepository(withTypes<Queries>(sql)).update({
      appId,
      ownerId: OWNER_ID,
      patch: { name: undefined, args: ['still-blocked'] },
    }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(await repository().abortStarted({ ...recovery, hostId })).toBe(true);
  expect(await repository().abortStarted({ ...recovery, hostId })).toBe(false);
  expect(await repository().findByApp({ appId, ownerId: OWNER_ID })).toMatchObject({
    state: 'failed',
    volume_storage_endpoint: null,
    volume_storage_bucket: null,
  });
  const retry = await repository().request(request);
  expect(await repository().findByApp({ appId, ownerId: OWNER_ID })).toMatchObject({
    volume_storage_migration_host_id: null,
    volume_storage_migration_started_at: null,
  });
  expect(await repository().abortStarted({ ...recovery, hostId })).toBe(false);
  expect(await repository().start({ ...attempt, configId: retry!.config_id, hostId })).toBe(true);
  expect(await repository().abortStarted({ ...recovery, hostId })).toBe(false);
  expect((await repository().findByApp({ appId, ownerId: OWNER_ID }))?.state).toBe('pending');
});

test.each(['pending', 'preparing', 'ready', 'failed'] as const)(
  'migration admission coordinates with an existing %s export',
  async (state) => {
    const appId = await createApp({ name: `export-${state}`, deployed: true, configured: false });
    const exports = new ExportsRepository(withTypes<Queries>(sql));
    const bundle = await exports.request({
      appId,
      ownerId: OWNER_ID,
      expiresAt: new Date(Date.now() + EXPORT_RETENTION_MS),
    });
    await exports.applyReport({
      reported: [
        {
          exportId: bundle!.id,
          state,
          checkpointId: null,
          sizeBytes: null,
          readyAt: null,
          message: null,
        },
      ],
    });
    const request = { appId, ownerId: OWNER_ID, destination: destination(ACCESS_KEY_AUTH) };
    if (state === 'pending' || state === 'preparing') {
      await expect(repository().request(request)).rejects.toBeInstanceOf(ConflictError);
      expect(await repository().findByApp({ appId, ownerId: OWNER_ID })).toBeNull();
      return;
    }
    expect(await repository().request(request)).toMatchObject({ state: 'pending' });
  },
);

test('exports are blocked until a queued migration is cancelled without exposing it to another owner', async () => {
  const appId = await createApp({
    name: 'migration-export-guard',
    deployed: true,
    configured: false,
  });
  const migration = await repository().request({
    appId,
    ownerId: OWNER_ID,
    destination: destination(ACCESS_KEY_AUTH),
  });
  const exports = new ExportsRepository(withTypes<Queries>(sql));
  const request = {
    appId,
    ownerId: OWNER_ID,
    expiresAt: new Date(Date.now() + EXPORT_RETENTION_MS),
  };
  await expect(exports.request(request)).rejects.toBeInstanceOf(ConflictError);
  expect(await exports.request({ ...request, ownerId: OTHER_OWNER_ID })).toBeNull();
  expect(await exports.listByApp({ appId, ownerId: OWNER_ID })).toEqual([]);
  expect(
    await repository().abort({
      appId,
      ownerId: OWNER_ID,
      configId: migration!.config_id,
      state: 'cancelled',
      message: null,
    }),
  ).toBe(true);
  const bundle = await exports.request(request);
  expect(bundle).not.toBeNull();
  expect(await exports.request(request)).toEqual(bundle);
});

test('concurrent export and migration requests admit exactly one operation', async () => {
  const appId = await createApp({
    name: 'migration-export-race',
    deployed: true,
    configured: false,
  });
  const exports = new ExportsRepository(withTypes<Queries>(sql));
  const results = await Promise.allSettled([
    exports.request({
      appId,
      ownerId: OWNER_ID,
      expiresAt: new Date(Date.now() + EXPORT_RETENTION_MS),
    }),
    repository().request({ appId, ownerId: OWNER_ID, destination: destination(ACCESS_KEY_AUTH) }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  for (const result of results) {
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(ConflictError);
    } else {
      expect(result.value).not.toBeNull();
    }
  }
  expect((await desiredVolumes()).find((volume) => volume.appId === appId)).not.toHaveProperty(
    'storage',
  );
});

test('legacy started attempts without a known host cannot be released by a guessed cleanup', async () => {
  const appId = await createApp({
    name: 'unknown-started-host',
    deployed: true,
    configured: false,
  });
  const migration = await repository().request({
    appId,
    ownerId: OWNER_ID,
    destination: destination(ACCESS_KEY_AUTH),
  });
  await sql.unsafe(
    `UPDATE nibrun.apps SET volume_storage_migration_started_at = now()
     WHERE id = $1 AND owner_id = $2`,
    [appId, OWNER_ID],
  );
  const recovery = {
    appId,
    ownerId: OWNER_ID,
    configId: migration!.config_id,
    state: 'failed' as const,
    message: 'Unknown writer.',
  };
  expect(await repository().abort(recovery)).toBe(false);
  expect(await repository().abortStarted({ ...recovery, hostId: HOST_ID })).toBe(false);
  expect(await repository().abortStarted({ ...recovery, hostId: OTHER_HOST_ID })).toBe(false);
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
