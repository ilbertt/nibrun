import { beforeAll, describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';

const BETTER_AUTH_SECRET_LENGTH = 32;

// The api reads its configuration when the service graph is constructed, so the environment
// has to exist before the app module is imported. Postgres is pointed at a closed port: every
// route below is refused before it would reach a query.
const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
  BETTER_AUTH_SECRET: 'x'.repeat(BETTER_AUTH_SECRET_LENGTH),
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  VICTORIALOGS_ENDPOINT: 'http://127.0.0.1:1',
  ARTIFACTS_BUCKET: 'test',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  S3_REGION: 'test',
  APP_HOST_DOMAIN: 'apps.test',
};

const APP_ID = 'app-1';
const DEPLOYMENT_ID = 'deployment-1';
const DEPLOYMENTS = `http://localhost/api/apps/${APP_ID}/deployments`;

let app: { handle: (request: Request) => Promise<Response> };

beforeAll(async () => {
  Object.assign(process.env, REQUIRED_ENV);
  const { createApp } = await import('#app.ts');
  app = createApp();
});

function get(url: string) {
  return app.handle(new Request(url));
}

function send({ method, url, body }: { method: string; url: string; body?: unknown }) {
  return app.handle(
    new Request(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  );
}

// A 401 rather than a 404 is what proves the route is mounted: an unmounted path under /api
// answers 404, so these assertions cover both the auth gate and the route tree.
describe('a deployment belongs to an app, and an app belongs to someone', () => {
  test('listing an app deployments without a session is refused', async () => {
    expect((await get(DEPLOYMENTS)).status).toBe(StatusMap.Unauthorized);
  });

  test('creating one is refused', async () => {
    const response = await send({
      method: 'POST',
      url: DEPLOYMENTS,
      body: { artifactId: 'artifact-1' },
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('fetching one is refused', async () => {
    expect((await get(`${DEPLOYMENTS}/${DEPLOYMENT_ID}`)).status).toBe(StatusMap.Unauthorized);
  });

  test('going back to one is refused, on the same route that deploys', async () => {
    const response = await send({
      method: 'POST',
      url: DEPLOYMENTS,
      body: { rollbackOf: DEPLOYMENT_ID },
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });
});
