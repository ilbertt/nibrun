import { afterEach, expect, mock, test } from 'bun:test';
import { deployBinary } from '#deploy.ts';
import { mockFetch } from '#tests/support/fetch.ts';

const ORIGIN = 'https://nibrun.test';
const APP_ID = 'app-1';
const ARTIFACT_ID = 'artifact-1';
const DEPLOYMENT_ID = 'deployment-1';
const STORAGE_URL = 'https://storage.test/upload?signature=secret';
const ACCESS_TOKEN = 'deployment-token';
const FAILURE_STATUS = 500;
const CREATED_STATUS = 201;
const AUTHENTICATED_REQUEST_COUNT = 3;

afterEach(function restoreMocks() {
  mock.restore();
});

function input() {
  return {
    apiUrl: ORIGIN,
    appId: APP_ID,
    filename: 'server',
    binary: new Blob(['compiled-binary']),
    credentials: {
      accessToken: mock(function accessToken() {
        return Promise.resolve(ACCESS_TOKEN);
      }),
    },
    maskSecret: mock(function mask(_secret: string) {}),
  };
}

test('uploads directly without exposing bearer credentials to storage, then completes and deploys', async () => {
  const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
  mockFetch(function fetchResponse(...args: Parameters<typeof fetch>) {
    const [resource, init] = args;
    const url = String(resource);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, headers: new Headers(init?.headers), body: String(init?.body) });
    if (url === STORAGE_URL) {
      return Promise.resolve(new Response(null));
    }
    if (method === 'PATCH') {
      return Promise.resolve(Response.json({ id: ARTIFACT_ID }));
    }
    if (url.endsWith('/deployments')) {
      return Promise.resolve(Response.json({ id: DEPLOYMENT_ID }, { status: CREATED_STATUS }));
    }
    return Promise.resolve(
      Response.json({ artifactId: ARTIFACT_ID, url: STORAGE_URL }, { status: CREATED_STATUS }),
    );
  });
  const options = input();
  expect(await deployBinary(options)).toBe(DEPLOYMENT_ID);
  expect(options.maskSecret).toHaveBeenCalledWith(STORAGE_URL);
  const storage = calls.find(function storageRequest(call) {
    return call.url === STORAGE_URL;
  });
  expect(storage?.headers.get('authorization')).toBeNull();
  expect(storage?.method).toBe('PUT');
  expect(storage?.headers.get('content-length')).toBe(String(options.binary.size));
  for (const call of calls.filter(function apiRequest(call) {
    return call.url.startsWith(ORIGIN);
  })) {
    expect(call.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
  }
  expect(
    calls.map(function requestMethod(call) {
      return call.method;
    }),
  ).toEqual(['POST', 'PUT', 'PATCH', 'POST']);
  expect(calls.at(-1)?.body).toBe(JSON.stringify({ artifactId: ARTIFACT_ID }));
  expect(options.credentials.accessToken).toHaveBeenCalledTimes(AUTHENTICATED_REQUEST_COUNT);
});

test('an unsuccessful upload is cancelled and never creates a deployment', async () => {
  const calls: string[] = [];
  mockFetch(function fetchResponse(...args: Parameters<typeof fetch>) {
    const [resource, init] = args;
    calls.push(String(resource));
    if (String(resource) === STORAGE_URL) {
      return Promise.resolve(new Response('private-storage-message', { status: FAILURE_STATUS }));
    }
    if (init?.method === 'PATCH') {
      expect(String(init.body)).toBe(JSON.stringify({ upload: 'failed' }));
      return Promise.resolve(new Response(null));
    }
    return Promise.resolve(
      Response.json({ artifactId: ARTIFACT_ID, url: STORAGE_URL }, { status: CREATED_STATUS }),
    );
  });
  await expect(deployBinary(input())).rejects.toThrow('Binary upload failed');
  expect(
    calls.some(function deploymentRequest(url) {
      return url.endsWith('/deployments');
    }),
  ).toBe(false);
});
