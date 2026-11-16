import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { OperationClient } from '#lib/operation-client.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { ArtifactsRepository } from '#repositories/artifacts.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { ExportsRepository } from '#repositories/exports.repository.ts';
import { ImageArtifactsRepository } from '#repositories/image-artifacts.repository.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import { createDeployedApp } from '#tests/support/deployed-app.ts';
import { registerHost, TEST_HOST_ID } from '#tests/support/hosts.ts';
import { ociImage } from '#tests/support/oci-image.ts';
import { refusedBy } from '#tests/support/postgres.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const DATABASE_TIMEOUT_MS = 180_000;
let sql: SQL;

beforeAll(async function startDatabase() {
  sql = await startTestDatabase();
}, DATABASE_TIMEOUT_MS);

afterAll(async function stopDatabase() {
  await stopTestDatabase(sql);
}, DATABASE_TIMEOUT_MS);

function repositories() {
  const typed = withTypes<Queries>(sql);
  return {
    images: new ImageArtifactsRepository(typed),
    binaries: new ArtifactsRepository(typed),
    deployments: new DeploymentsRepository(typed),
    agent: new AgentRepository({ sql: typed, secretsKey: TEST_SECRETS_KEY }),
  };
}

test('registry artifacts retain their source without claiming an uploaded object', async () => {
  const app = await createDeployedApp({ sql, name: 'registry-source', hostId: TEST_HOST_ID });
  const { images, binaries } = repositories();
  const row = await images.insert({ ...app, image: ociImage() });
  expect(row?.image_repository).toBe(ociImage().repository);
  expect(row?.digest).toBe(ociImage().digest);
  expect((await images.listByApp(app)).map((item) => item.id)).toEqual([row!.id]);
  expect(await binaries.findById({ ...app, artifactId: row!.id })).toBeNull();
  expect(
    await images.findById({
      ...app,
      artifactId: row!.id,
      ownerId: Value.Parse(OwnerIdSchema, 'another-owner'),
    }),
  ).toBeNull();
  expect(
    await images.listByApp({ ...app, ownerId: Value.Parse(OwnerIdSchema, 'another-owner') }),
  ).toEqual([]);
  const [stored] = await sql.unsafe(
    'SELECT size_bytes, object_key, original_file_name FROM nibrun.artifacts WHERE id = $1',
    [row!.id],
  );
  expect(stored).toMatchObject({ size_bytes: null, object_key: null, original_file_name: null });
});

test('an image supersedes the binary deployment on the existing host', async () => {
  const app = await createDeployedApp({ sql, name: 'existing-image-host', hostId: TEST_HOST_ID });
  const { images, deployments } = repositories();
  const row = await images.insert({ ...app, image: ociImage() });
  expect(
    await deployments.insert({
      ...app,
      artifactId: row!.id,
      client: OperationClient.Cli,
      initialDataFrom: null,
      onlyOne: false,
    }),
  ).toMatchObject({ outcome: 'created' });
  expect((await deployments.findById(app))?.state).toBe('superseded');
  const [placed] = await sql.unsafe(
    'SELECT host_id FROM nibrun.deployments WHERE artifact_id = $1',
    [row!.id],
  );
  expect(placed.host_id).toBe(TEST_HOST_ID);
});

test('a registered host receives the image command and digest in desired state', async () => {
  const { images, deployments, agent } = repositories();
  const hostId = await registerHost({ sql, originId: 'image-host' });
  const app = await createDeployedApp({ sql, name: 'registered-image-host', hostId });
  const row = await images.insert({ ...app, image: ociImage() });
  const created = await deployments.insert({
    ...app,
    artifactId: row!.id,
    client: OperationClient.Cli,
    initialDataFrom: null,
    onlyOne: false,
  });
  expect(created.outcome).toBe('created');
  const desired = await agent.desiredState({ hostId, retainedDeploymentsPerApp: 2 });
  expect(desired.instances.find((instance) => instance.appId === app.appId)?.artifact).toEqual(
    ociImage(),
  );
  expect((await deployments.findById(app))?.state).toBe('superseded');
  const exports = new ExportsRepository(withTypes<Queries>(sql));
  const expiresAt = new Date(Date.now() + DATABASE_TIMEOUT_MS);
  await expect(exports.request({ ...app, expiresAt })).rejects.toThrow(
    'Exports are not available for OCI image deployments yet.',
  );
  expect((await agent.desiredState({ hostId, retainedDeploymentsPerApp: 2 })).exports).toEqual([]);
});

test('new image deployments select a ready host', async () => {
  const { images, deployments } = repositories();
  const hostId = await registerHost({ sql, originId: 'ready-image-host' });
  await sql.unsafe(
    "UPDATE nibrun.hosts SET reported_state = 'ready', last_seen_at = now() WHERE id = $1",
    [hostId],
  );
  const app = await createDeployedApp({ sql, name: 'new-image-host', hostId: TEST_HOST_ID });
  await sql.unsafe('DELETE FROM nibrun.deployments WHERE id = $1', [app.deploymentId]);
  const row = await images.insert({ ...app, image: ociImage() });
  const created = await deployments.insert({
    ...app,
    artifactId: row!.id,
    client: OperationClient.Cli,
    initialDataFrom: null,
    onlyOne: false,
  });
  expect(created.outcome).toBe('created');
  const [placed] = await sql.unsafe('SELECT host_id FROM nibrun.deployments WHERE app_id = $1', [
    app.appId,
  ]);
  expect(placed.host_id).toBe(hostId);
});

test('host registration renewals preserve image deployments and rollbacks', async () => {
  const { images, deployments, agent } = repositories();
  const originId = 'renewed-image-host';
  const hostId = await registerHost({ sql, originId });
  const app = await createDeployedApp({ sql, name: originId, hostId });
  const row = await images.insert({ ...app, image: ociImage() });
  const image = await deployments.insert({
    ...app,
    artifactId: row!.id,
    client: OperationClient.Cli,
    initialDataFrom: null,
    onlyOne: false,
  });
  if (image.outcome !== 'created') {
    throw new Error('The image deployment was not created.');
  }
  const binaryApp = await createDeployedApp({ sql, name: 'renewal-binary-app', hostId });
  expect(await agent.registerHost({ originId })).toBe(hostId);
  const desired = await agent.desiredState({ hostId, retainedDeploymentsPerApp: 2 });
  expect(desired.instances.find((instance) => instance.appId === app.appId)?.artifact).toEqual(
    ociImage(),
  );
  expect(desired.instances.map((instance) => instance.appId)).toContain(binaryApp.appId);
  expect(desired.volumes.map((volume) => volume.appId)).toContain(app.appId);
  expect((await deployments.findById({ ...app, deploymentId: image.row.id }))?.state).toBe(
    'pending',
  );
  const rollback = await deployments.insertRollback({
    ...app,
    client: OperationClient.Cli,
    rollbackOf: image.row.id,
  });
  expect(rollback?.artifact_id).toBe(row!.id);
  expect((await deployments.findById(binaryApp))?.state).toBe('running');
});

test('the database rejects an ambiguous image and uploaded object', async () => {
  const app = await createDeployedApp({
    sql,
    name: 'ambiguous-image-source',
    hostId: TEST_HOST_ID,
  });
  expect(
    await refusedBy(async function addImageToBinary() {
      await sql.unsafe(
        "UPDATE nibrun.artifacts SET image_repository = $1, image_program = '/app/server', image_working_directory = '/app' WHERE id = $2",
        [ociImage().repository, app.artifactId],
      );
    }),
  ).toBe('artifacts_source_check');
});
