import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { GITHUB_ACTIONS_OIDC_AUDIENCE } from '@repo/api-constants';
import { DeploymentCredentials } from '#lib/deployment-credentials.ts';
import { mockFetch } from '#tests/support/fetch.ts';

const ORIGIN = 'https://nibrun.test';
const APP_ID = 'app-1';
const TOKEN_URL = `${ORIGIN}/api/apps/${APP_ID}/deployment-tokens`;
const TOKEN_LIFETIME_MS = 300_000;
const FAILURE_STATUS = 401;

function credentialResponse() {
  return Response.json({
    token: 'deployment-access',
    expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString(),
  });
}
afterEach(function restoreMocks() {
  mock.restore();
});

test('exchanges GitHub proof for an app credential and masks both secrets', async () => {
  const identity = mock(function identityToken() {
    return Promise.resolve('github-identity');
  });
  const maskSecret = mock(function mask(_secret: string) {});
  const requests: { url: string; method: string | undefined; headers: Headers }[] = [];
  mockFetch(function fetchResponse(...args: Parameters<typeof fetch>) {
    const [url, init] = args;
    requests.push({ url: String(url), method: init?.method, headers: new Headers(init?.headers) });
    return Promise.resolve(credentialResponse());
  });
  const credentials = new DeploymentCredentials({
    apiUrl: ORIGIN,
    appId: APP_ID,
    getIdentityToken: identity,
    maskSecret,
  });
  expect(await credentials.accessToken()).toBe('deployment-access');
  expect(await credentials.accessToken()).toBe('deployment-access');
  expect(identity).toHaveBeenCalledTimes(1);
  expect(identity).toHaveBeenCalledWith(GITHUB_ACTIONS_OIDC_AUDIENCE);
  expect(maskSecret.mock.calls).toEqual([['github-identity'], ['deployment-access']]);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(TOKEN_URL);
  expect(requests[0]?.method).toBe('POST');
  expect(requests[0]?.headers.get('authorization')).toBe('Bearer github-identity');
});

test('renews expired access using fresh GitHub identity', async () => {
  const identity = mock(function identityToken() {
    return Promise.resolve('fresh-github-identity');
  });
  let now = Date.now();
  spyOn(Date, 'now').mockImplementation(function currentTime() {
    return now;
  });
  mockFetch(function fetchResponse() {
    return Promise.resolve(credentialResponse());
  });
  const credentials = new DeploymentCredentials({
    apiUrl: ORIGIN,
    appId: APP_ID,
    getIdentityToken: identity,
    maskSecret: function mask(_secret) {},
  });
  await credentials.accessToken();
  now += TOKEN_LIFETIME_MS;
  await credentials.accessToken();
  expect(identity).toHaveBeenCalledTimes(2);
});

test('rejects non-origin API URLs before requesting identity', () => {
  for (const apiUrl of [
    'http://nibrun.test',
    `${ORIGIN}/path`,
    `${ORIGIN}?query=1`,
    `${ORIGIN}#fragment`,
    'https://user:secret@nibrun.test',
  ]) {
    expect(function constructCredentials() {
      return new DeploymentCredentials({
        apiUrl,
        appId: APP_ID,
        getIdentityToken: function identityToken() {
          return Promise.resolve('secret');
        },
        maskSecret: function mask(_secret) {},
      });
    }).toThrow('HTTPS origin');
  }
});

test('rejects missing or expired deployment credentials', async () => {
  for (const body of [
    { token: '', expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString() },
    { token: 'expired', expiresAt: new Date(0).toISOString() },
    { token: 'invalid', expiresAt: 'invalid-date' },
  ]) {
    mockFetch(function fetchResponse() {
      return Promise.resolve(Response.json(body));
    });
    const credentials = new DeploymentCredentials({
      apiUrl: ORIGIN,
      appId: APP_ID,
      getIdentityToken: function identityToken() {
        return Promise.resolve('github-secret');
      },
      maskSecret: function mask(_secret) {},
    });
    await expect(credentials.accessToken()).rejects.toThrow('Could not obtain deployment access');
  }
});

test('exchange errors never expose response contents or GitHub secrets', async () => {
  mockFetch(function fetchResponse() {
    return Promise.resolve(
      Response.json({ error: 'sensitive-secret' }, { status: FAILURE_STATUS }),
    );
  });
  const credentials = new DeploymentCredentials({
    apiUrl: ORIGIN,
    appId: APP_ID,
    getIdentityToken: function identityToken() {
      return Promise.resolve('github-secret');
    },
    maskSecret: function mask(_secret) {},
  });
  try {
    await credentials.accessToken();
    throw new Error('Expected exchange failure.');
  } catch (error) {
    expect(String(error)).toContain('Could not obtain deployment access');
    expect(String(error)).toContain('HTTP 401');
    expect(String(error)).toContain(
      'trusted GitHub repository, workflow filename, and environment',
    );
    expect(String(error)).not.toContain('sensitive-secret');
    expect(String(error)).not.toContain('github-secret');
  }
});

test('unexpected identity errors never expose transport details or credentials', async () => {
  const credentials = new DeploymentCredentials({
    apiUrl: ORIGIN,
    appId: APP_ID,
    getIdentityToken: function identityToken() {
      return Promise.reject(new Error('private-error https://github.test/?token=github-secret'));
    },
    maskSecret: function mask(_secret) {},
  });
  await expect(credentials.accessToken()).rejects.toThrow(
    'Could not request GitHub identity. Check id-token: write permission.',
  );
});
