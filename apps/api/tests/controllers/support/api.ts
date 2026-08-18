const BETTER_AUTH_SECRET_LENGTH = 32;

// The api reads its configuration when the service graph is constructed, so the environment has
// to exist before the app module is imported — hence the dynamic import below. Postgres and the
// object store are pointed at closed ports: no route reached from here gets that far.
Object.assign(process.env, {
  DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
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
});

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
