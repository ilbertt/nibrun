import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { type AppId, HostnameSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import { type Queries, schema } from '#db/queries.gen.ts';
import { AppNameSchema } from '#lib/api/app.ts';
import { DnsLabelSchema } from '#lib/api/dns-label.ts';
import { ArtifactIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';
import { configWithDefaults } from '#lib/app-config.ts';
import { DEPLOYMENT_GRANT_LIFETIME_MS } from '#lib/deployment-grant-policy.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import type { GitHubActionsOidcClaims } from '#lib/github-actions-oidc.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
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
const OWNER_ID = Value.Parse(OwnerIdSchema, 'grant-owner');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'grant-stranger');
let sql: SQL;
let key: SigningKey;
const APP_QUOTA = 100;

beforeAll(async function initializeDatabase() {
  sql = await startTestDatabase();
  key = await signingKey({ kid: 'database-grants' });
  for (const ownerId of [OWNER_ID, OTHER_OWNER_ID]) {
    await sql.unsafe(
      `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, now(), now())`,
      [ownerId, `${ownerId}@example.test`],
    );
    await sql.unsafe('UPDATE nibrun.profiles SET quota_apps_max_count = $1 WHERE owner_id = $2', [
      APP_QUOTA,
      ownerId,
    ]);
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
  const slug = Value.Parse(DnsLabelSchema, `grant-${Bun.randomUUIDv7()}`);
  const created = await new AppsRepository(withTypes<Queries>(sql)).create({
    ownerId: OWNER_ID,
    anonymousAppsAtMost: null,
    name: Value.Parse(AppNameSchema, 'Grant app'),
    slug,
    hostname: Value.Parse(HostnameSchema, `${slug}.apps.test`),
    config: { ...configWithDefaults(), environment: {} },
  });
  if (created.outcome !== 'created') {
    throw new Error('The grant fixture app must be created.');
  }
  const appId = created.app.id;
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

test.each(['refs/heads/main', 'refs/tags/v2026.10.4'])(
  'independent API instances share grant references and immutable GitHub provenance from %s',
  async (ref) => {
    const appId = await configuredApp();
    const claims = {
      ...identity(),
      ref,
      sub: `repo:acme/backend:ref:${ref}`,
      workflow_ref: `acme/backend/.github/workflows/deploy.yml@${ref}`,
      run_attempt: '2',
      environment: 'production',
      job_workflow_ref: 'acme/workflows/.github/workflows/deploy.yml@refs/heads/main',
      job_workflow_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    };
    const issued = await grant({ appId, claims });
    const authorized = await service().authenticate({
      appId,
      grantId: issued.id,
      ownerId: OWNER_ID,
    });
    expect(authorized).toMatchObject(githubGrantProvenance(claims));
    expect(authorized.owner_id).toBe(OWNER_ID);
    expect(authorized.app_id).toBe(appId);
    const rows = await sql.unsafe(
      'SELECT id, github_token_jti FROM nibrun.github_deployment_grants WHERE app_id = $1 AND owner_id = $2',
      [appId, OWNER_ID],
    );
    expect(rows).toEqual([{ id: issued.id, github_token_jti: claims.jti }]);
    const otherApp = await configuredApp();
    await expect(
      service().authenticate({ appId: otherApp, grantId: issued.id, ownerId: OWNER_ID }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      service().authenticate({ appId, grantId: issued.id, ownerId: OTHER_OWNER_ID }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  },
);

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
  await expect(
    service().authenticate({ appId, grantId: issued.id, ownerId: OWNER_ID }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
});

test('revocation and recreation preserve replay protection without reviving an old grant', async () => {
  const appId = await configuredApp();
  const identityToken = await signToken({ key, claims: identity() });
  const issued = await service().exchange({ appId, identityToken });
  const authorized = await service().authenticate({ appId, grantId: issued.id, ownerId: OWNER_ID });
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
  await expect(
    service().authenticate({ appId, grantId: issued.id, ownerId: OWNER_ID }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
  expect(await grantsRepository().findTrust({ appId, repository: 'acme/backend' })).toBeNull();
  await expect(service().exchange({ appId, identityToken })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  await workflowsRepository().create({ appId, ownerId: OWNER_ID, workflow: trustedWorkflow() });
  await expect(
    service().authenticate({ appId, grantId: issued.id, ownerId: OWNER_ID }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
  await expect(service().exchange({ appId, identityToken })).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  const replacement = await grant({ appId });
  expect(
    (await service().authenticate({ appId, grantId: replacement.id, ownerId: OWNER_ID })).id,
  ).toBe(replacement.id);
});

test('expired grants cannot authenticate or free their consumed GitHub identity for replay', async () => {
  const appId = await configuredApp();
  const identityToken = await signToken({ key, claims: identity() });
  const issued = await service().exchange({ appId, identityToken });
  await sql.unsafe(
    "UPDATE nibrun.github_deployment_grants SET expires_at = now() - interval '1 second' WHERE id = $1 AND owner_id = $2",
    [issued.id, OWNER_ID],
  );
  await expect(
    service().authenticate({ appId, grantId: issued.id, ownerId: OWNER_ID }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
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
    expiresAt: new Date(Date.now() + DEPLOYMENT_GRANT_LIFETIME_MS),
  };
  expect(await repository.create({ ...input, ownerId: OTHER_OWNER_ID })).toBeNull();
  expect(await repository.create({ ...input, identity: { ...input.identity, exp: 1 } })).toBeNull();
  await workflowsRepository().update({
    appId,
    ownerId: OWNER_ID,
    workflowId: trust.id,
    workflow: trustedWorkflow({ workflow: 'release.yml' }),
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
  await expect(
    service().authenticate({ appId, grantId: issued.id, ownerId: OWNER_ID }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
  const deletedApp = await configuredApp();
  const deletedGrant = await grant({ appId: deletedApp });
  await sql.unsafe("UPDATE nibrun.apps SET state = 'deleted' WHERE id = $1 AND owner_id = $2", [
    deletedApp,
    OWNER_ID,
  ]);
  await expect(
    service().authenticate({ appId: deletedApp, grantId: deletedGrant.id, ownerId: OWNER_ID }),
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
  expect((await service().authenticate({ appId, grantId: issued.id, ownerId: OWNER_ID })).id).toBe(
    issued.id,
  );
});

async function deploymentInput(appId: AppId) {
  const [artifact] = await sql.unsafe(
    `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
     VALUES ($1, $2, 1, 'binary', 'server') RETURNING id`,
    [appId, new Bun.CryptoHasher('sha256').update('binary').digest('hex')],
  );
  return {
    appId,
    ownerId: OWNER_ID,
    artifactId: Value.Parse(ArtifactIdSchema, artifact.id),
    initialDataFrom: null,
    onlyOne: false,
  };
}

test('deployment provenance survives grant expiry and workflow revocation', async () => {
  const appId = await configuredApp();
  const issued = await grant({ appId });
  const repository = new DeploymentsRepository(withTypes<Queries>(sql));
  const deployed = await repository.insertWithDeploymentGrant({
    ...(await deploymentInput(appId)),
    deploymentGrantId: issued.id,
  });
  if (deployed.outcome !== 'created') {
    throw new Error('The GitHub deployment must be created.');
  }
  const authorized = await service().authenticate({ appId, ownerId: OWNER_ID, grantId: issued.id });
  await workflowsRepository().remove({
    appId,
    ownerId: OWNER_ID,
    workflowId: authorized.workflow_id,
  });
  await sql.unsafe(
    "UPDATE nibrun.github_deployment_grants SET expires_at = now() - interval '1 second' WHERE id = $1 AND owner_id = $2",
    [issued.id, OWNER_ID],
  );
  expect(
    await repository.findById({ appId, ownerId: OWNER_ID, deploymentId: deployed.row.id }),
  ).toMatchObject({
    github_repository: authorized.github_repository,
    github_workflow_ref: authorized.github_workflow_ref,
    github_ref: authorized.github_ref,
    github_commit_sha: authorized.github_commit_sha,
    github_run_id: authorized.github_run_id,
    github_run_attempt: authorized.github_run_attempt,
  });
  expect((await repository.listByApp({ appId, ownerId: OWNER_ID }))[0]?.github_run_id).toBe(
    authorized.github_run_id,
  );
});

test('manual redeploys and rollbacks do not inherit a GitHub artifact origin', async () => {
  const appId = await configuredApp();
  const issued = await grant({ appId });
  const input = await deploymentInput(appId);
  const repository = new DeploymentsRepository(withTypes<Queries>(sql));
  const github = await repository.insertWithDeploymentGrant({
    ...input,
    deploymentGrantId: issued.id,
  });
  if (github.outcome !== 'created') {
    throw new Error('The GitHub deployment must be created.');
  }
  const manual = await repository.insert(input);
  expect(manual.outcome === 'created' ? manual.row.github_repository : undefined).toBeNull();
  const rollback = await repository.insertRollback({
    appId,
    ownerId: OWNER_ID,
    rollbackOf: github.row.id,
  });
  expect(rollback?.github_repository).toBeNull();
  expect(rollback?.artifact_id).toBe(github.row.artifact_id);
});

test('another app grant cannot attach provenance or supersede the existing deployment', async () => {
  const appId = await configuredApp();
  const foreignGrant = await grant({ appId: await configuredApp() });
  const input = await deploymentInput(appId);
  const repository = new DeploymentsRepository(withTypes<Queries>(sql));
  const current = await repository.insert(input);
  if (current.outcome !== 'created') {
    throw new Error('The current deployment must be created.');
  }
  expect(
    await repository.insertWithDeploymentGrant({ ...input, deploymentGrantId: foreignGrant.id }),
  ).toEqual({ outcome: 'no-grant' });
  expect(
    await repository.insertWithDeploymentGrant({
      ...input,
      ownerId: OTHER_OWNER_ID,
      deploymentGrantId: foreignGrant.id,
    }),
  ).toEqual({ outcome: 'no-artifact' });
  expect(
    await repository.findById({ appId, ownerId: OWNER_ID, deploymentId: current.row.id }),
  ).toMatchObject({ state: 'pending', github_repository: null });
});
