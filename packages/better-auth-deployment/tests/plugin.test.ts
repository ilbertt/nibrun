import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory';
import { getSchema } from 'better-auth/db';
import {
  DEPLOYMENT_TOKEN_CONFIG_ID,
  DEPLOYMENT_TOKEN_MODEL_NAME,
  DEPLOYMENT_TOKEN_PERMISSION,
  deploymentTokenApiKeyConfiguration,
  deploymentTokenApiKeySchema,
} from '#configuration.ts';
import { deploymentTokens } from '#plugin.ts';

const LIFETIME_SECONDS = 300;
const MS_PER_SECOND = 1000;
const ORIGIN = 'https://auth.test';
const OWNER_ID = 'owner-1';
const APP_ID = 'app-1';
const GRANT_ID = 'grant-1';
const SECRET_LENGTH = 32;
const NOT_FOUND_STATUS = 404;
const OK_STATUS = 200;
const FORBIDDEN_STATUS = 403;

function setup() {
  const database: MemoryDB = {};
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: 'x'.repeat(SECRET_LENGTH),
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true },
    plugins: [
      apiKey(
        [
          deploymentTokenApiKeyConfiguration({ maximumLifetimeSeconds: LIFETIME_SECONDS }),
          { configId: 'default', enableMetadata: true, keyExpiration: { minExpiresIn: 0 } },
        ],
        {
          schema: deploymentTokenApiKeySchema,
        },
      ),
      deploymentTokens(),
    ],
  });
  for (const table of Object.keys(getSchema(auth.options))) {
    database[table] = [];
  }
  return { auth, database };
}

function grant() {
  return {
    ownerId: OWNER_ID,
    appId: APP_ID,
    grantId: GRANT_ID,
    expiresAt: new Date(Date.now() + LIFETIME_SECONDS * MS_PER_SECOND),
  };
}

function bearer(token: string) {
  return new Headers({ authorization: `Bearer ${token}` });
}

test('native keys are hashed, app scoped, grant bound and capped by the grant expiration', async () => {
  const { auth, database } = setup();
  const authorization = grant();
  const credential = await auth.api.issueDeploymentToken({ body: authorization });
  expect(credential.expiresAt.getTime()).toBeLessThanOrEqual(authorization.expiresAt.getTime());
  expect(database[DEPLOYMENT_TOKEN_MODEL_NAME]?.[0]?.key).not.toBe(credential.token);
  const identity = await auth.api.authenticateDeploymentToken({
    headers: bearer(credential.token),
    body: { appId: APP_ID },
  });
  expect(identity).toEqual({
    ownerId: OWNER_ID,
    appId: APP_ID,
    grantId: GRANT_ID,
    expiresAt: credential.expiresAt,
  });
  await expect(
    auth.api.authenticateDeploymentToken({
      headers: bearer(credential.token),
      body: { appId: 'app-2' },
    }),
  ).rejects.toThrow();
  expect(await auth.api.getSession({ headers: bearer(credential.token) })).toBeNull();
});

test('issuance refuses expired grants and credentials beyond the configured lifetime', async () => {
  const { auth } = setup();
  for (const expiresAt of [
    new Date(0),
    new Date(Date.now() + LIFETIME_SECONDS * MS_PER_SECOND * 2),
  ]) {
    await expect(
      auth.api.issueDeploymentToken({ body: { ...grant(), expiresAt } }),
    ).rejects.toThrow();
  }
});

test('native revocation prevents subsequent authentication', async () => {
  const { auth } = setup();
  const credential = await auth.api.issueDeploymentToken({ body: grant() });
  const verification = await auth.api.verifyApiKey({
    body: { configId: DEPLOYMENT_TOKEN_CONFIG_ID, key: credential.token },
  });
  expect(verification.valid).toBe(true);
  await auth.api.updateApiKey({
    body: {
      configId: DEPLOYMENT_TOKEN_CONFIG_ID,
      keyId: verification.key!.id,
      userId: OWNER_ID,
      enabled: false,
    },
  });
  await expect(
    auth.api.authenticateDeploymentToken({
      headers: bearer(credential.token),
      body: { appId: APP_ID },
    }),
  ).rejects.toThrow();
});

test('the plugin rejects invalid credentials and missing Bearer authentication', async () => {
  const { auth } = setup();
  for (const headers of [
    new Headers(),
    bearer('invalid'),
    new Headers({ authorization: 'Basic invalid' }),
  ]) {
    await expect(
      auth.api.authenticateDeploymentToken({ headers, body: { appId: APP_ID } }),
    ).rejects.toThrow();
  }
});

test('issuance and authentication have no public HTTP route', async () => {
  const { auth } = setup();
  for (const path of ['/issue-deployment-token', '/authenticate-deployment-token']) {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(NOT_FOUND_STATUS);
  }
});

afterEach(function restoreMocks() {
  mock.restore();
});

test('native expiration prevents subsequent authentication', async () => {
  const { auth } = setup();
  const credential = await auth.api.issueDeploymentToken({ body: grant() });
  spyOn(Date, 'now').mockReturnValue(credential.expiresAt.getTime() + MS_PER_SECOND);
  await expect(
    auth.api.authenticateDeploymentToken({
      headers: bearer(credential.token),
      body: { appId: APP_ID },
    }),
  ).rejects.toThrow();
});

test('public callers cannot create or change deployment credentials', async () => {
  const { auth } = setup();
  for (const path of ['create', 'update']) {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/api-key/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ configId: DEPLOYMENT_TOKEN_CONFIG_ID }),
      }),
    );
    expect(response.status).toBe(FORBIDDEN_STATUS);
  }
});

test('the configured schema identifies the deployment table explicitly', () => {
  const { auth, database } = setup();
  expect(getSchema(auth.options)).toHaveProperty(DEPLOYMENT_TOKEN_MODEL_NAME);
  expect(database).toHaveProperty(DEPLOYMENT_TOKEN_MODEL_NAME);
  expect(database).not.toHaveProperty('apikey');
});

test('general API keys remain available without granting deployment access', async () => {
  const { auth } = setup();
  const signup = await auth.api.signUpEmail({
    body: { name: 'Owner', email: 'owner@example.test', password: 'correct-horse-battery-staple' },
    asResponse: true,
  });
  const cookie = signup.headers
    .getSetCookie()
    .map(function cookieValue(value) {
      return value.split(';')[0];
    })
    .join('; ');
  const headers = { 'content-type': 'application/json', origin: ORIGIN, cookie };
  const created = await auth.handler(
    new Request(`${ORIGIN}/api/auth/api-key/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ configId: 'default', name: 'General key' }),
    }),
  );
  expect(created.status).toBe(OK_STATUS);
  const general = (await created.json()) as { id: string; key: string; referenceId: string };
  const updated = await auth.handler(
    new Request(`${ORIGIN}/api/auth/api-key/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ configId: 'default', keyId: general.id, name: 'Renamed general key' }),
    }),
  );
  expect(updated.status).toBe(OK_STATUS);
  await expect(
    auth.api.authenticateDeploymentToken({ headers: bearer(general.key), body: { appId: APP_ID } }),
  ).rejects.toThrow();
  const forgedScope = await auth.api.createApiKey({
    body: {
      configId: 'default',
      userId: general.referenceId,
      expiresIn: LIFETIME_SECONDS,
      permissions: { [APP_ID]: [DEPLOYMENT_TOKEN_PERMISSION] },
      metadata: { grantId: GRANT_ID },
    },
  });
  await expect(
    auth.api.authenticateDeploymentToken({
      headers: bearer(forgedScope.key),
      body: { appId: APP_ID },
    }),
  ).rejects.toThrow();
  const credential = await auth.api.issueDeploymentToken({
    body: { ...grant(), ownerId: general.referenceId },
  });
  const verification = await auth.api.verifyApiKey({
    body: { configId: DEPLOYMENT_TOKEN_CONFIG_ID, key: credential.token },
  });
  const mutation = {
    configId: DEPLOYMENT_TOKEN_CONFIG_ID,
    keyId: verification.key!.id,
    expiresIn: null,
    metadata: { grantId: 'another-grant' },
  };
  const forbidden = await auth.handler(
    new Request(`${ORIGIN}/api/auth/api-key/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify(mutation),
    }),
  );
  expect(forbidden.status).toBe(FORBIDDEN_STATUS);
  for (const configId of ['default', undefined, 'unknown']) {
    const bypass = await auth.handler(
      new Request(`${ORIGIN}/api/auth/api-key/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...mutation, configId }),
      }),
    );
    expect(bypass.status).toBe(NOT_FOUND_STATUS);
  }
  expect(
    await auth.api.authenticateDeploymentToken({
      headers: bearer(credential.token),
      body: { appId: APP_ID },
    }),
  ).toMatchObject({ grantId: GRANT_ID, expiresAt: credential.expiresAt });
});
