import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import {
  type AppId,
  AppIdSchema,
  FilenameSchema,
  ObjectKeySchema,
  Sha256DigestSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import { type Queries, schema } from '#db/queries.gen.ts';
import { type DeploymentGrantId, OwnerIdSchema } from '#lib/api/identifiers.ts';
import { DEPLOYMENT_GRANT_LIFETIME_MS } from '#lib/deployment-grant-policy.ts';
import {
  createDeploymentGrantToken,
  deploymentGrantTokenHash,
} from '#lib/deployment-grant-token.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import type { GitHubActionsOidcClaims } from '#lib/github-actions-oidc.ts';
import { ArtifactsRepository } from '#repositories/artifacts.repository.ts';
import { GitHubDeploymentGrantsRepository } from '#repositories/github-deployment-grants.repository.ts';
import { TrustedWorkflowsRepository } from '#repositories/trusted-workflows.repository.ts';
import { GitHubDeploymentGrantsService } from '#services/github-deployment-grants.service.ts';
import { startTestDatabase, stopTestDatabase } from '#tests/support/database.ts';
import {
  GitHubOidcProviderFixture,
  githubClaims,
  type SigningKey,
  signingKey,
  signToken,
} from '#tests/support/github-actions-oidc.ts';
import { githubGrantProvenance } from '#tests/support/github-deployment-grants.ts';
import { trustedWorkflow } from '#tests/support/trusted-workflows.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
const FIXTURE_DIGEST = new Bun.CryptoHasher('sha256').update('binary').digest('hex');
const OWNER_ID = Value.Parse(OwnerIdSchema, 'grant-owner');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'grant-stranger');
let sql: SQL;
let key: SigningKey;

beforeAll(async function initializeDatabase() {
  sql = await startTestDatabase();
  key = await signingKey({ kid: 'database-grants' });
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

function grantsRepository() {
  return new GitHubDeploymentGrantsRepository(withTypes<Queries>(sql));
}

function workflowsRepository() {
  return new TrustedWorkflowsRepository(withTypes<Queries>(sql));
}

function service() {
  return new GitHubDeploymentGrantsService({
    identityService: new GitHubOidcProviderFixture([key.jwk]).service(),
    grantsRepo: grantsRepository(),
  });
}

function identity(): GitHubActionsOidcClaims {
  return { ...githubClaims(), jti: Bun.randomUUIDv7() };
}

async function configuredApp(): Promise<AppId> {
  const rows = await sql.unsafe(
    `INSERT INTO nibrun.apps (owner_id, name, slug) VALUES ($1, 'Grant app', $2) RETURNING id`,
    [OWNER_ID, `grant-${Bun.randomUUIDv7()}`],
  );
  const appId = Value.Parse(AppIdSchema, rows[0].id);
  await workflowsRepository().create({ appId, ownerId: OWNER_ID, workflow: trustedWorkflow() });
  return appId;
}

async function grant({
  appId,
  claims = identity(),
}: {
  appId: AppId;
  claims?: GitHubActionsOidcClaims;
}) {
  const identityToken = await signToken({ key, claims });
  return service().exchange({ appId, identityToken });
}

test('independent API instances share hashed grants and their immutable GitHub run-attempt provenance', async () => {
  const appId = await configuredApp();
  const claims = {
    ...identity(),
    run_attempt: '2',
    environment: 'production',
    job_workflow_ref: 'acme/workflows/.github/workflows/deploy.yml@refs/heads/main',
    job_workflow_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  };
  const issued = await grant({ appId, claims });
  const authorized = await service().authenticate({ appId, token: issued.token });
  expect(authorized).toMatchObject(githubGrantProvenance(claims));
  expect(authorized.owner_id).toBe(OWNER_ID);
  expect(authorized.app_id).toBe(appId);
  const rows = await sql.unsafe(
    'SELECT token_hash FROM nibrun.github_deployment_grants WHERE app_id = $1 AND owner_id = $2',
    [appId, OWNER_ID],
  );
  expect(rows).toEqual([{ token_hash: deploymentGrantTokenHash(issued.token) }]);
  expect(rows[0].token_hash).not.toBe(issued.token);
  const otherApp = await configuredApp();
  await expect(
    service().authenticate({ appId: otherApp, token: issued.token }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
  await expect(
    service().authenticate({ appId, token: issued.token.replace(OWNER_ID, OTHER_OWNER_ID) }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
});

test('concurrent exchanges consume the same GitHub token once per app', async () => {
  const appId = await configuredApp();
  const identityToken = await signToken({ key, claims: identity() });
  const outcomes = await Promise.allSettled([
    service().exchange({ appId, identityToken }),
    service().exchange({ appId, identityToken }),
  ]);
  expect(
    outcomes.filter(function succeeded(outcome) {
      return outcome.status === 'fulfilled';
    }),
  ).toHaveLength(1);
  const rejected = outcomes.find(function failed(outcome) {
    return outcome.status === 'rejected';
  });
  expect(rejected?.status === 'rejected' ? rejected.reason : null).toBeInstanceOf(
    UnauthorizedError,
  );
  const rows = await sql.unsafe(
    'SELECT id FROM nibrun.github_deployment_grants WHERE app_id = $1 AND owner_id = $2',
    [appId, OWNER_ID],
  );
  expect(rows).toHaveLength(1);
});

test('even an unchanged workflow update rotates authorization and revokes existing grants', async () => {
  const appId = await configuredApp();
  const issued = await grant({ appId });
  const trust = await grantsRepository().findTrust({ appId, repository: 'acme/backend' });
  if (!trust) {
    throw new Error('Missing fixture trust');
  }
  await workflowsRepository().update({
    appId,
    ownerId: OWNER_ID,
    workflowId: trust.id,
    workflow: trustedWorkflow(),
  });
  const updated = await grantsRepository().findTrust({ appId, repository: 'acme/backend' });
  expect(updated?.current_revision).not.toBe(trust.current_revision);
  await expect(service().authenticate({ appId, token: issued.token })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
});

test('revocation and recreation preserve replay protection without reviving an old grant', async () => {
  const appId = await configuredApp();
  const identityToken = await signToken({ key, claims: identity() });
  const issued = await service().exchange({ appId, identityToken });
  const authorized = await service().authenticate({ appId, token: issued.token });
  await workflowsRepository().remove({
    appId,
    ownerId: OWNER_ID,
    workflowId: authorized.workflow_id,
  });
  const retainedGrants = await sql.unsafe(
    'SELECT workflow_id, github_token_jti FROM nibrun.github_deployment_grants WHERE id = $1 AND owner_id = $2',
    [issued.id, OWNER_ID],
  );
  expect(retainedGrants).toEqual([
    { workflow_id: authorized.workflow_id, github_token_jti: authorized.github_token_jti },
  ]);
  await expect(service().authenticate({ appId, token: issued.token })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  expect(await grantsRepository().findTrust({ appId, repository: 'acme/backend' })).toBeNull();
  await expect(service().exchange({ appId, identityToken })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  await workflowsRepository().create({ appId, ownerId: OWNER_ID, workflow: trustedWorkflow() });
  await expect(service().authenticate({ appId, token: issued.token })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  await expect(service().exchange({ appId, identityToken })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  const replacement = await grant({ appId });
  expect((await service().authenticate({ appId, token: replacement.token })).id).toBe(
    replacement.id,
  );
});

test('expired grants cannot authenticate or free their consumed GitHub identity for replay', async () => {
  const appId = await configuredApp();
  const identityToken = await signToken({ key, claims: identity() });
  const issued = await service().exchange({ appId, identityToken });
  await sql.unsafe(
    "UPDATE nibrun.github_deployment_grants SET expires_at = now() - interval '1 second' WHERE id = $1 AND owner_id = $2",
    [issued.id, OWNER_ID],
  );
  await expect(service().authenticate({ appId, token: issued.token })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  await expect(service().exchange({ appId, identityToken })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
});

test('a rule changed after verification and an identity expired before insertion cannot issue grants', async () => {
  const appId = await configuredApp();
  const repository = grantsRepository();
  const trust = await repository.findTrust({ appId, repository: 'acme/backend' });
  if (!trust) {
    throw new Error('Missing fixture trust');
  }
  const input = {
    appId,
    ownerId: OWNER_ID,
    trust,
    identity: identity(),
    tokenHash: deploymentGrantTokenHash(createDeploymentGrantToken({ ownerId: OWNER_ID })),
    expiresAt: new Date(Date.now() + DEPLOYMENT_GRANT_LIFETIME_MS),
  };
  expect(await repository.create({ ...input, ownerId: OTHER_OWNER_ID })).toBeNull();
  expect(await repository.create({ ...input, identity: { ...input.identity, exp: 1 } })).toBeNull();
  await workflowsRepository().update({
    appId,
    ownerId: OWNER_ID,
    workflowId: trust.id,
    workflow: trustedWorkflow({ branch: 'production' }),
  });
  expect(await repository.create(input)).toBeNull();
});

test('ownership transfer and app deletion invalidate existing deployment capabilities', async () => {
  const appId = await configuredApp();
  const issued = await grant({ appId });
  await sql.unsafe('UPDATE nibrun.apps SET owner_id = $1 WHERE id = $2 AND owner_id = $3', [
    OTHER_OWNER_ID,
    appId,
    OWNER_ID,
  ]);
  await expect(service().authenticate({ appId, token: issued.token })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  const deletedApp = await configuredApp();
  const deletedGrant = await grant({ appId: deletedApp });
  await sql.unsafe("UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1 AND owner_id = $2", [
    deletedApp,
    OWNER_ID,
  ]);
  await expect(
    service().authenticate({ appId: deletedApp, token: deletedGrant.token }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
  await expect(grant({ appId: deletedApp })).rejects.toBeInstanceOf(UnauthorizedError);
});

test('the workflow foreign key rejects references to a nonexistent trust rule', async () => {
  const appId = await configuredApp();
  const issued = await grant({ appId });
  async function referenceMissingWorkflow() {
    await sql.unsafe(
      'UPDATE nibrun.github_deployment_grants SET workflow_id = $1 WHERE id = $2 AND owner_id = $3',
      [Bun.randomUUIDv7(), issued.id, OWNER_ID],
    );
  }
  await expect(referenceMissingWorkflow()).rejects.toMatchObject({
    errno: '23503',
    constraint:
      schema.github_deployment_grants._constraints.github_deployment_grants_workflow_id_fkey
        ._constraintName,
  });
  expect((await service().authenticate({ appId, token: issued.token })).id).toBe(issued.id);
});

function artifactsRepository() {
  return new ArtifactsRepository(withTypes<Queries>(sql));
}

async function pendingUpload({
  appId,
  deploymentGrantId,
}: {
  appId: AppId;
  deploymentGrantId: DeploymentGrantId | null;
}) {
  const input = {
    appId,
    ownerId: OWNER_ID,
    deploymentGrantId,
    originalFileName: Value.Parse(FilenameSchema, 'server'),
    originalFileUrl: null,
    sourceDigest: null,
    onlyOne: false,
  };
  const created = await artifactsRepository().insertPending(input);
  if (created.outcome !== 'created') {
    throw new Error('Missing fixture upload');
  }
  return {
    ...input,
    artifactId: created.row.id,
    digest: Value.Parse(Sha256DigestSchema, FIXTURE_DIGEST),
    sizeBytes: 1024,
    objectKey: Value.Parse(ObjectKeySchema, 'sha256/server'),
  };
}

test('grant uploads are bound to their app, tenant, and issuing grant', async () => {
  const appId = await configuredApp();
  const issued = await grant({ appId });
  const secondGrant = await grant({ appId });
  const input = await pendingUpload({ appId, deploymentGrantId: issued.id });
  expect(
    await artifactsRepository().complete({ ...input, deploymentGrantId: secondGrant.id }),
  ).toBeNull();
  expect(await artifactsRepository().complete({ ...input, deploymentGrantId: null })).toBeNull();
  expect(await artifactsRepository().complete({ ...input, ownerId: OTHER_OWNER_ID })).toBeNull();
  const stored = await artifactsRepository().complete(input);
  expect(stored?.github_deployment_grant_id).toBe(issued.id);
  expect(stored?.digest).toBe(input.digest);
  expect(await artifactsRepository().complete(input)).toBeNull();
  const otherApp = await configuredApp();
  const refused = await artifactsRepository().insertPending({ ...input, appId: otherApp });
  expect(refused.outcome).toBe('no-app');
});

test('the composite foreign key rejects linking an artifact to another app grant', async () => {
  const appId = await configuredApp();
  const otherApp = await configuredApp();
  const otherGrant = await grant({ appId: otherApp });
  const upload = await pendingUpload({ appId, deploymentGrantId: null });
  async function crossAppReference() {
    await sql.unsafe(
      'UPDATE nibrun.artifacts SET github_deployment_grant_id = $1 WHERE id = $2 AND app_id = $3',
      [otherGrant.id, upload.artifactId, appId],
    );
  }
  await expect(crossAppReference()).rejects.toMatchObject({
    errno: '23503',
    constraint: schema.artifacts._constraints.artifacts_github_deployment_grant_fk._constraintName,
  });
});

test('expiry during upload inspection prevents completion and subsequent upload creation', async () => {
  const appId = await configuredApp();
  const issued = await grant({ appId });
  const input = await pendingUpload({ appId, deploymentGrantId: issued.id });
  await sql.unsafe(
    "UPDATE nibrun.github_deployment_grants SET expires_at = now() - interval '1 second' WHERE id = $1 AND owner_id = $2",
    [issued.id, OWNER_ID],
  );
  expect(await artifactsRepository().complete(input)).toBeNull();
  expect((await artifactsRepository().insertPending(input)).outcome).toBe('no-app');
  expect((await artifactsRepository().findPending(input))?.id).toBe(input.artifactId);
});

test('workflow changes and soft deletion revoke in-flight uploads', async () => {
  for (const deletion of [false, true]) {
    const appId = await configuredApp();
    const issued = await grant({ appId });
    const authorized = await service().authenticate({ appId, token: issued.token });
    const input = await pendingUpload({ appId, deploymentGrantId: issued.id });
    const workflow = { appId, ownerId: OWNER_ID, workflowId: authorized.workflow_id };
    if (deletion) {
      await workflowsRepository().remove(workflow);
    } else {
      await workflowsRepository().update({ ...workflow, workflow: trustedWorkflow() });
    }
    expect(await artifactsRepository().complete(input)).toBeNull();
    expect((await artifactsRepository().insertPending(input)).outcome).toBe('no-app');
  }
});

test('account uploads still complete without a deployment grant', async () => {
  const appId = await configuredApp();
  const input = await pendingUpload({ appId, deploymentGrantId: null });
  expect((await artifactsRepository().complete(input))?.github_deployment_grant_id).toBeNull();
});

test('app deletion and ownership transfer revoke in-flight grant uploads for both owners', async () => {
  for (const deletion of [false, true]) {
    const appId = await configuredApp();
    const issued = await grant({ appId });
    const input = await pendingUpload({ appId, deploymentGrantId: issued.id });
    if (deletion) {
      await sql.unsafe("UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1 AND owner_id = $2", [
        appId,
        OWNER_ID,
      ]);
    } else {
      await sql.unsafe('UPDATE nibrun.apps SET owner_id = $1 WHERE id = $2 AND owner_id = $3', [
        OTHER_OWNER_ID,
        appId,
        OWNER_ID,
      ]);
    }
    for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
      expect(await artifactsRepository().complete({ ...input, ownerId })).toBeNull();
      expect((await artifactsRepository().insertPending({ ...input, ownerId })).outcome).toBe(
        'no-app',
      );
    }
  }
});
