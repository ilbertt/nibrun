import { afterAll } from 'bun:test';
import { startTestDatabase, stopTestDatabase, TEST_DATABASE_URL } from '#tests/support/database.ts';
import { TEST_SECRETS_KEY_BASE64 } from '#tests/support/secrets.ts';

const BETTER_AUTH_SECRET_LENGTH = 32;

const DATABASE_START_TIMEOUT_MS = 180_000;

// The api reads its configuration when the service graph is constructed, so the environment has
// to exist before the app module is imported — hence the dynamic import below. The object store is
// pointed at a closed port: no route reached from here gets that far.
//
// Postgres is the suite's own database, brought up below before the api is imported rather than by
// a test hook. Constructing better-auth with the oauth provider starts the plugin seeding its
// resource row, and that lands as an unhandled rejection during module evaluation — before any
// `beforeAll` could have started anything — which takes the whole file down with it.
Object.assign(process.env, {
  DATABASE_URL: TEST_DATABASE_URL,
  BETTER_AUTH_SECRET: 'x'.repeat(BETTER_AUTH_SECRET_LENGTH),
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  VICTORIALOGS_ENDPOINT: 'http://127.0.0.1:1',
  ARTIFACTS_BUCKET: 'test',
  EXPORTS_BUCKET: 'test-exports',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  S3_REGION: 'test',
  APP_HOST_DOMAIN: 'apps.test',
  TENANT_SECRETS_KEY: TEST_SECRETS_KEY_BASE64,
});

const sql = await startTestDatabase();

const { createApp } = await import('#app.ts');

const api = createApp();

// A bare path is not a URL, so every request here carries an origin. Nothing routes on it.
export const ORIGIN = 'http://localhost';

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
  return api.handle(new Request(url, { method, headers, body, signal }));
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

/**
 * Take the suite's database down once this file is done with it.
 *
 * Called by the one file that reaches the database, which is what makes it the file that owns
 * putting it away. Everything else here is answered before a query is reached, so a container
 * already stopped costs those files nothing.
 */
export function useTestDatabase(): void {
  afterAll(async () => {
    await stopTestDatabase(sql);
  }, DATABASE_START_TIMEOUT_MS);
}
