import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import {
  APP_SCOPE,
  apiKeyAuth,
  FIRST_APP,
  FOREIGN_APP,
  member,
  ownerRequest,
  SECOND_APP,
  UNSELECTED_APP,
} from '#tests/support/api-key-auth.ts';

const MS_PER_SECOND = 1_000;

test('a key authenticates its owner and only its hash is stored', async () => {
  const { auth, app, database } = apiKeyAuth();
  const { user, headers } = await member({ auth, email: 'owner@example.com' });
  const key = await auth.api.createApiKey({
    body: { name: 'GitHub Actions', metadata: APP_SCOPE },
    headers,
  });
  expect(key.key.startsWith('nib_')).toBe(true);
  expect(database.apikey?.[0]?.key).not.toBe(key.key);
  const response = await app.handle(ownerRequest(key.key));
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({ id: user.id });
  const listed = await auth.api.listApiKeys({ headers });
  expect(listed.apiKeys[0]?.name).toBe('GitHub Actions');
  expect(listed.apiKeys[0]).not.toHaveProperty('key');
});

test('revoking a key immediately prevents deployment authentication', async () => {
  const { auth, app } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  const key = await auth.api.createApiKey({ body: { name: 'CI', metadata: APP_SCOPE }, headers });
  await auth.api.deleteApiKey({ body: { keyId: key.id }, headers });
  expect((await app.handle(ownerRequest(key.key))).status).toBe(StatusMap.Unauthorized);
});

test('expired and disabled keys are refused', async () => {
  const { auth, app } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  for (const change of [{ expiresAt: new Date(0) }, { enabled: false }]) {
    const key = await auth.api.createApiKey({ body: { name: 'CI', metadata: APP_SCOPE }, headers });
    const context = await auth.$context;
    await context.adapter.update({
      model: 'apikey',
      where: [{ field: 'id', value: key.id }],
      update: change,
    });
    expect((await app.handle(ownerRequest(key.key))).status).toBe(StatusMap.Unauthorized);
  }
});

test('invalid keys cannot fall back to a valid browser session', async () => {
  const { auth, app } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  for (const key of ['', 'invalid']) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('x-api-key', key);
    const response = await app.handle(
      new Request(`http://localhost/api/apps/${FIRST_APP}`, { headers: requestHeaders }),
    );
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
});

test('another owner cannot see or revoke a key', async () => {
  const { auth } = apiKeyAuth();
  const owner = await member({ auth, email: 'owner@example.com' });
  const other = await member({ auth, email: 'other@example.com' });
  const key = await auth.api.createApiKey({
    body: { name: 'CI', metadata: APP_SCOPE },
    headers: owner.headers,
  });
  expect((await auth.api.listApiKeys({ headers: other.headers })).apiKeys).toEqual([]);
  await expect(
    auth.api.deleteApiKey({ body: { keyId: key.id }, headers: other.headers }),
  ).rejects.toThrow();
});

test('an API key cannot create another key or change the account', async () => {
  const { auth } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  const key = await auth.api.createApiKey({ body: { name: 'CI', metadata: APP_SCOPE }, headers });
  const keyHeaders = new Headers({ 'x-api-key': key.key });
  await expect(
    auth.api.createApiKey({ body: { name: 'Another key' }, headers: keyHeaders }),
  ).rejects.toThrow('Sign in');
  await expect(
    auth.api.updateUser({ body: { name: 'Changed' }, headers: keyHeaders }),
  ).rejects.toThrow('Sign in');
});

test('anonymous accounts cannot create keys', async () => {
  const { auth } = apiKeyAuth();
  const response = await auth.api.signInAnonymous({ asResponse: true });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const headers = new Headers({ cookie });
  await expect(
    auth.api.createApiKey({ body: { name: 'CI', metadata: APP_SCOPE }, headers }),
  ).rejects.toThrow('Sign in');
});

test('keys retain their configured expiration', async () => {
  const { auth } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  const expiresIn = 86_400;
  const before = Date.now();
  const key = await auth.api.createApiKey({
    body: { name: 'CI', expiresIn, metadata: APP_SCOPE },
    headers,
  });
  expect(key.expiresAt?.getTime()).toBeGreaterThanOrEqual(before + expiresIn * MS_PER_SECOND);
});

test('deployment polling is not restricted to the plugin default of ten requests a day', async () => {
  const { auth, app } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  const key = await auth.api.createApiKey({ body: { name: 'CI', metadata: APP_SCOPE }, headers });
  const pollingRequests = 20;
  for (let count = 0; count < pollingRequests; count++) {
    expect((await app.handle(ownerRequest(key.key))).status).toBe(StatusMap.OK);
  }
});

test('exhausting the key rate limit returns 429', async () => {
  const { auth, app } = apiKeyAuth();
  const { user } = await member({ auth, email: 'owner@example.com' });
  const key = await auth.api.createApiKey({
    body: {
      name: 'CI',
      metadata: APP_SCOPE,
      userId: user.id,
      rateLimitMax: 1,
    },
  });
  expect((await app.handle(ownerRequest(key.key))).status).toBe(StatusMap.OK);
  expect((await app.handle(ownerRequest(key.key))).status).toBe(StatusMap['Too Many Requests']);
});

test('one key can deploy to several selected apps and refuses another app of the same owner', async () => {
  const { auth, app } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  const appIds = [FIRST_APP, SECOND_APP];
  const key = await auth.api.createApiKey({ body: { name: 'CI', metadata: { appIds } }, headers });
  for (const appId of appIds) {
    const response = await app.handle(
      new Request(`http://localhost/api/apps/${appId}/deployments`, {
        method: 'POST',
        headers: { 'x-api-key': key.key },
      }),
    );
    expect(response.status).toBe(StatusMap.OK);
  }
  const denied = await app.handle(
    new Request(`http://localhost/api/apps/${UNSELECTED_APP}/deployments`, {
      method: 'POST',
      headers: { 'x-api-key': key.key },
    }),
  );
  expect(denied.status).toBe(StatusMap.Forbidden);
  const listed = await app.handle(
    new Request('http://localhost/api/apps', {
      headers: { 'x-api-key': key.key },
    }),
  );
  expect(await listed.json()).toEqual({ appIds });
});

test('keys cannot create new apps', async () => {
  const { auth, app } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  const key = await auth.api.createApiKey({ body: { name: 'CI', metadata: APP_SCOPE }, headers });
  const response = await app.handle(
    new Request('http://localhost/api/apps', {
      method: 'POST',
      headers: { 'x-api-key': key.key },
    }),
  );
  expect(response.status).toBe(StatusMap.Forbidden);
});

test.each([undefined, {}, { appIds: [] }, { appIds: [FIRST_APP, FIRST_APP] }, { appIds: ['*'] }])(
  'creating a key requires an explicit set of app IDs: %j',
  async (metadata) => {
    const { auth } = apiKeyAuth();
    const { headers } = await member({ auth, email: 'owner@example.com' });
    await expect(
      auth.api.createApiKey({ body: { name: 'CI', metadata }, headers }),
    ).rejects.toThrow('Select');
  },
);

test('key scopes can include only existing apps of the signed-in owner', async () => {
  const { auth } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  await member({ auth, email: 'other@example.com' });
  for (const appId of [FOREIGN_APP, 'missing-app']) {
    await expect(
      auth.api.createApiKey({
        body: { name: 'CI', metadata: { appIds: [FIRST_APP, appId] } },
        headers,
      }),
    ).rejects.toThrow('Select only apps you own');
  }
});

test('clients cannot override permissions computed from the selected apps', async () => {
  const { auth } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  await expect(
    auth.api.createApiKey({
      body: {
        name: 'CI',
        metadata: APP_SCOPE,
        permissions: { apps: [UNSELECTED_APP] },
      },
      headers,
    }),
  ).rejects.toThrow();
});

test('a key without app permissions grants no access', async () => {
  const { auth, app } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  const key = await auth.api.createApiKey({ body: { name: 'CI', metadata: APP_SCOPE }, headers });
  const context = await auth.$context;
  await context.adapter.update({
    model: 'apikey',
    where: [{ field: 'id', value: key.id }],
    update: { permissions: null },
  });
  expect((await app.handle(ownerRequest(key.key))).status).toBe(StatusMap.Forbidden);
});

test('connection IDs authorize the app the database connection belongs to', async () => {
  const { auth, app } = apiKeyAuth();
  const { headers } = await member({ auth, email: 'owner@example.com' });
  const key = await auth.api.createApiKey({ body: { name: 'CI', metadata: APP_SCOPE }, headers });
  for (const suffix of ['', '/v2/pipeline']) {
    const method = suffix === '' ? 'GET' : 'POST';
    const allowed = await app.handle(
      new Request(`http://localhost/api/sqlite/connections/first-connection${suffix}`, {
        method,
        headers: { 'x-api-key': key.key },
      }),
    );
    expect(allowed.status).toBe(StatusMap.OK);
    const denied = await app.handle(
      new Request(`http://localhost/api/sqlite/connections/unselected-connection${suffix}`, {
        method,
        headers: { 'x-api-key': key.key },
      }),
    );
    expect(denied.status).toBe(StatusMap.Forbidden);
  }
});
