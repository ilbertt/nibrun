import { mock } from 'bun:test';
import { type MemoryDB, memoryAdapter } from 'better-auth/adapters/memory';
import { getSchema } from 'better-auth/db';
import { TEST_API_ORIGIN } from '#tests/support/api-origin.ts';
import { fetchTestClientMetadataResource } from '#tests/support/cimd.ts';
import { TEST_SECRETS_KEY_BASE64 } from '#tests/support/secrets.ts';

const BETTER_AUTH_SECRET_LENGTH = 32;

// The api reads its configuration when the service graph is constructed, so the environment has
// to exist before the app module is imported — hence the dynamic import below. Postgres and the
// object store are pointed at closed ports: no route reached from here gets that far.
Object.assign(process.env, {
  BASE_URL: TEST_API_ORIGIN,
  DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
  BETTER_AUTH_SECRET: 'x'.repeat(BETTER_AUTH_SECRET_LENGTH),
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  VICTORIALOGS_ENDPOINT: 'http://127.0.0.1:1',
  ARTIFACTS_BUCKET: 'test',
  EXPORTS_BUCKET: 'test-exports',
  IMPORTS_BUCKET: 'test-imports',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  S3_REGION: 'test',
  APP_HOST_DOMAIN: 'apps.test',
  TENANT_SECRETS_KEY: TEST_SECRETS_KEY_BASE64,
});

const { createAuth } = await import('#lib/auth/better-auth.ts');
const authDatabase: MemoryDB = {};
mock.module('#lib/auth/better-auth.ts', function controllerAuthFactory() {
  return {
    createAuth(input: Parameters<typeof createAuth>[0]) {
      const auth = createAuth({
        ...input,
        database: memoryAdapter(authDatabase),
        fetchClientMetadataResource: fetchTestClientMetadataResource,
      });
      for (const table of Object.keys(getSchema(auth.options))) {
        authDatabase[table] ??= [];
      }
      return auth;
    },
  };
});

const { createApp } = await import('#app.ts');

const api = createApp();

// A bare path is not a URL, so every request here carries an origin. Nothing routes on it.
export const ORIGIN = 'http://localhost';

export type Route = { method: string; path: string };

/** Every route the app mounts under a prefix, as it lists them itself — `:appId` and all. */
export function routesUnder(prefix: string): Route[] {
  return api.routes
    .filter((route) => route.path.startsWith(prefix))
    .map(({ method, path }) => ({ method, path }));
}

export function sendRequest(request: Request): Promise<Response> {
  return api.handle(request);
}

// `signal` is the caller going away, exactly as it is for a request off a socket: a route that
// holds one open has nothing else to end it inside a test.
export function send({
  method = 'GET',
  url,
  body,
  headers,
  signal,
}: {
  method?: string;
  url: string;
  body?: RequestInit['body'];
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<Response> {
  return sendRequest(new Request(url, { method, headers, body, signal }));
}

export function sendJson({
  method = 'GET',
  url,
  body,
  headers,
  signal,
}: {
  method?: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<Response> {
  return send({
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}
