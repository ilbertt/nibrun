import { afterAll, beforeAll, expect, test } from 'bun:test';
import { withTypes } from '@ilbertt/bun-sqlgen';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { DEPLOYMENT_GRANT_LIFETIME_MS } from '#lib/deployment-grant-policy.ts';
import {
  createDeploymentGrantToken,
  deploymentGrantTokenHash,
} from '#lib/deployment-grant-token.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import type { GitHubActionsOidcClaims } from '#lib/github-actions-oidc.ts';
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
import { trustedWorkflow } from '#tests/support/trusted-workflows.ts';

const DATABASE_START_TIMEOUT_MS = 180_000;
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
  const claims = { ...identity(), run_attempt: '2', environment: 'production' };
  const issued = await grant({ appId, claims });
  const authorized = await service().authenticate({ appId, token: issued.token });
  expect(authorized.identity).toEqual(claims);
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
  expect(updated?.revision).not.toBe(trust.revision);
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
  await expect(service().authenticate({ appId, token: issued.token })).rejects.toBeInstanceOf(
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
