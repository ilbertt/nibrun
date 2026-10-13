import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory';
import { getSchema } from 'better-auth/db';
import { StatusMap } from 'elysia';
import {
  DEPLOYMENT_TOKEN_PERMISSION,
  protectShortLivedDeploymentTokens,
  shortLivedDeploymentTokenConfiguration,
} from '#lib/auth/deployment-api-keys.ts';
import { DEPLOYMENT_TOKEN_LIFETIME_SECONDS } from '#lib/deployment-grant-policy.ts';

const ORIGIN = 'https://auth.test';
const SECRET_LENGTH = 32;
const REGULAR_CONFIG_ID = 'default';
const OWNER_ID = 'owner-1';
const APP_ID = 'app-1';
const GRANT_ID = 'grant-1';
const MS_PER_SECOND = 1000;
const HEX_RADIX = 16;

function setup() {
  const database: MemoryDB = {};
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: 'x'.repeat(SECRET_LENGTH),
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true },
    hooks: { before: protectShortLivedDeploymentTokens },
    plugins: [
      apiKey([
        shortLivedDeploymentTokenConfiguration,
        { configId: REGULAR_CONFIG_ID, keyExpiration: { minExpiresIn: 0 } },
      ]),
    ],
  });
  for (const table of Object.keys(getSchema(auth.options))) {
    database[table] = [];
  }
  return { auth, database };
}

function keyBody() {
  return {
    configId: shortLivedDeploymentTokenConfiguration.configId,
    userId: OWNER_ID,
    expiresIn: DEPLOYMENT_TOKEN_LIFETIME_SECONDS,
    permissions: { [APP_ID]: [DEPLOYMENT_TOKEN_PERMISSION] },
    metadata: { grantId: GRANT_ID },
  };
}

async function account({ auth, email }: { auth: ReturnType<typeof setup>['auth']; email: string }) {
  const signup = await auth.api.signUpEmail({
    body: { name: 'Owner', email, password: 'correct-horse-battery-staple' },
    returnHeaders: true,
  });
  const cookie = signup.headers
    .getSetCookie()
    .map(function cookieValue(value) {
      return value.split(';')[0];
    })
    .join('; ');
  return {
    ownerId: signup.response.user.id,
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
  };
}

function keyRequest({
  path,
  headers,
  body,
}: {
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}) {
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(function restoreMocks() {
  mock.restore();
});

test('deployment credentials use native hashed apikey storage and cannot impersonate an account', async () => {
  const { auth, database } = setup();
  const credential = await auth.api.createApiKey({ body: keyBody() });
  expect(database.apikey?.[0]?.key).not.toBe(credential.key);
  expect(database).not.toHaveProperty('deploymentToken');
  expect(
    await auth.api.getSession({
      headers: new Headers({
        authorization: `Bearer ${credential.key}`,
        'x-api-key': credential.key,
      }),
    }),
  ).toBeNull();
  const verified = await auth.api.verifyApiKey({
    body: {
      configId: shortLivedDeploymentTokenConfiguration.configId,
      key: credential.key,
      permissions: { [APP_ID]: [DEPLOYMENT_TOKEN_PERMISSION] },
    },
  });
  expect(verified.valid).toBe(true);
  expect(verified.key).toMatchObject({ referenceId: OWNER_ID, metadata: { grantId: GRANT_ID } });
  expect(
    (
      await auth.api.verifyApiKey({
        body: {
          configId: shortLivedDeploymentTokenConfiguration.configId,
          key: credential.key,
          permissions: { 'other-app': [DEPLOYMENT_TOKEN_PERMISSION] },
        },
      })
    ).valid,
  ).toBe(false);
});

test('native expiration limits, expiry and revocation remain enforced', async () => {
  const { auth } = setup();
  await expect(
    auth.api.createApiKey({
      body: { ...keyBody(), expiresIn: DEPLOYMENT_TOKEN_LIFETIME_SECONDS + 1 },
    }),
  ).rejects.toThrow();
  const revoked = await auth.api.createApiKey({ body: keyBody() });
  await auth.api.updateApiKey({
    body: {
      configId: shortLivedDeploymentTokenConfiguration.configId,
      keyId: revoked.id,
      userId: OWNER_ID,
      enabled: false,
    },
  });
  expect(
    (
      await auth.api.verifyApiKey({
        body: { configId: shortLivedDeploymentTokenConfiguration.configId, key: revoked.key },
      })
    ).valid,
  ).toBe(false);
  const expired = await auth.api.createApiKey({ body: keyBody() });
  spyOn(Date, 'now').mockReturnValue(expired.expiresAt!.getTime() + MS_PER_SECOND);
  expect(
    (
      await auth.api.verifyApiKey({
        body: { configId: shortLivedDeploymentTokenConfiguration.configId, key: expired.key },
      })
    ).valid,
  ).toBe(false);
});

test('public callers cannot create or change deployment credentials', async () => {
  const { auth } = setup();
  for (const path of ['create', 'update']) {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/api-key/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ configId: shortLivedDeploymentTokenConfiguration.configId }),
      }),
    );
    expect(response.status).toBe(StatusMap.Forbidden);
  }
  await expect(
    auth.api.createApiKey({
      headers: new Headers(),
      body: keyBody(),
    }),
  ).rejects.toThrow('Deployment credentials can only be issued and updated by the server.');
});

test('regular API keys remain available and cannot be used to mutate deployment keys', async () => {
  const { auth } = setup();
  const { headers } = await account({ auth, email: 'owner@example.test' });
  const created = await auth.handler(
    new Request(`${ORIGIN}/api/auth/api-key/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ configId: REGULAR_CONFIG_ID, name: 'Regular key' }),
    }),
  );
  expect(created.status).toBe(StatusMap.OK);
  const regular = (await created.json()) as { id: string; key: string; referenceId: string };
  const updated = await auth.handler(
    new Request(`${ORIGIN}/api/auth/api-key/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ configId: REGULAR_CONFIG_ID, keyId: regular.id, name: 'Renamed' }),
    }),
  );
  expect(updated.status).toBe(StatusMap.OK);
  const credential = await auth.api.createApiKey({
    body: { ...keyBody(), userId: regular.referenceId },
  });
  const mutation = {
    keyId: credential.id,
    expiresIn: null,
    metadata: { grantId: 'another-grant' },
  };
  for (const configId of [
    shortLivedDeploymentTokenConfiguration.configId,
    REGULAR_CONFIG_ID,
    undefined,
    'unknown',
  ]) {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/api-key/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...mutation, configId }),
      }),
    );
    expect(response.status).toBe(
      configId === shortLivedDeploymentTokenConfiguration.configId
        ? StatusMap.Forbidden
        : StatusMap['Not Found'],
    );
  }
  const verification = await auth.api.verifyApiKey({
    body: { configId: shortLivedDeploymentTokenConfiguration.configId, key: credential.key },
  });
  expect(verification.key).toMatchObject({
    metadata: { grantId: GRANT_ID },
    expiresAt: credential.expiresAt,
  });
});

test('alternate URL spellings cannot bypass deployment creation or update guards', async () => {
  const { auth, database } = setup();
  const { headers, ownerId } = await account({ auth, email: 'paths@example.test' });
  const credential = await auth.api.createApiKey({ body: { ...keyBody(), userId: ownerId } });
  for (const action of ['create', 'update']) {
    for (const path of [
      `/api-key/${action}`,
      `/api-key/${action}/`,
      `/api-key//${action}`,
      `/api-key/%${action.charCodeAt(0).toString(HEX_RADIX)}${action.slice(1)}`,
      `/API-KEY/${action}`,
    ]) {
      const response = await auth.handler(
        keyRequest({
          path,
          headers,
          body: {
            configId: shortLivedDeploymentTokenConfiguration.configId,
            keyId: credential.id,
            expiresIn: null,
            metadata: { grantId: 'another-grant' },
            context: { headers: null, request: null },
          },
        }),
      );
      expect(response.ok).toBe(false);
    }
  }
  expect(database.apikey).toHaveLength(1);
  const verification = await auth.api.verifyApiKey({
    body: { configId: shortLivedDeploymentTokenConfiguration.configId, key: credential.key },
  });
  expect(verification.key).toMatchObject({
    metadata: { grantId: GRANT_ID },
    expiresAt: credential.expiresAt,
  });
});

test('omitted, unknown and malformed configuration IDs cannot mutate a deployment key', async () => {
  const { auth } = setup();
  const { headers, ownerId } = await account({ auth, email: 'config@example.test' });
  const credential = await auth.api.createApiKey({ body: { ...keyBody(), userId: ownerId } });
  for (const configId of [undefined, '', 'unknown', REGULAR_CONFIG_ID, null, [], {}]) {
    const response = await auth.handler(
      keyRequest({
        path: `/api-key/update?configId=${shortLivedDeploymentTokenConfiguration.configId}`,
        headers,
        body: {
          configId,
          keyId: credential.id,
          expiresIn: null,
          metadata: { grantId: 'another-grant' },
        },
      }),
    );
    expect(response.ok).toBe(false);
  }
  const verification = await auth.api.verifyApiKey({
    body: { configId: shortLivedDeploymentTokenConfiguration.configId, key: credential.key },
  });
  expect(verification.key).toMatchObject({
    metadata: { grantId: GRANT_ID },
    expiresAt: credential.expiresAt,
  });
});

test('native ownership checks protect deployment-key reads and revocation', async () => {
  const { auth } = setup();
  const owner = await account({ auth, email: 'key-owner@example.test' });
  const outsider = await account({ auth, email: 'outsider@example.test' });
  const credential = await auth.api.createApiKey({ body: { ...keyBody(), userId: owner.ownerId } });
  const configId = shortLivedDeploymentTokenConfiguration.configId;
  const unauthorizedCredentials: Record<string, string>[] = [
    { 'content-type': 'application/json' },
    { 'content-type': 'application/json', authorization: `Bearer ${credential.key}` },
    outsider.headers,
  ];
  for (const headers of unauthorizedCredentials) {
    const get = await auth.handler(
      keyRequest({
        path: `/api-key/get?configId=${configId}&id=${credential.id}`,
        headers,
        body: undefined,
      }),
    );
    expect(get.ok).toBe(false);
    const deletion = await auth.handler(
      keyRequest({
        path: '/api-key/delete',
        headers,
        body: { configId, keyId: credential.id },
      }),
    );
    expect(deletion.ok).toBe(false);
  }
  const list = await auth.handler(
    keyRequest({
      path: `/api-key/list?configId=${configId}`,
      headers: outsider.headers,
      body: undefined,
    }),
  );
  expect(await list.json()).toMatchObject({ apiKeys: [], total: 0 });
  const get = await auth.handler(
    keyRequest({
      path: `/api-key/get?configId=${configId}&id=${credential.id}`,
      headers: owner.headers,
      body: undefined,
    }),
  );
  expect(get.status).toBe(StatusMap.OK);
  expect(await get.json()).not.toHaveProperty('key');
  const deletion = await auth.handler(
    keyRequest({
      path: '/api-key/delete',
      headers: owner.headers,
      body: { configId, keyId: credential.id },
    }),
  );
  expect(deletion.status).toBe(StatusMap.OK);
  expect((await auth.api.verifyApiKey({ body: { configId, key: credential.key } })).valid).toBe(
    false,
  );
});
