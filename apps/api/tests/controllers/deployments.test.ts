import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const APP_ID = 'app-1';
const DEPLOYMENT_ID = 'deployment-1';
const DEPLOYMENTS_URL = `${ORIGIN}/api/apps/${APP_ID}/deployments`;

// A 401 rather than a 404 is what proves the route is mounted: an unmounted path under /api
// answers 404, so these assertions cover both the auth gate and the route tree.
describe('a deployment belongs to an app, and an app belongs to someone', () => {
  test('listing an app deployments without a session is refused', async () => {
    expect((await sendJson({ url: DEPLOYMENTS_URL })).status).toBe(StatusMap.Unauthorized);
  });

  test('creating one is refused', async () => {
    const response = await sendJson({
      method: 'POST',
      url: DEPLOYMENTS_URL,
      body: { artifactId: 'artifact-1' },
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('fetching one is refused', async () => {
    const response = await sendJson({ url: `${DEPLOYMENTS_URL}/${DEPLOYMENT_ID}` });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('going back to one is refused, on the same route that deploys', async () => {
    const response = await sendJson({
      method: 'POST',
      url: DEPLOYMENTS_URL,
      body: { rollbackOf: DEPLOYMENT_ID },
    });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });
});
