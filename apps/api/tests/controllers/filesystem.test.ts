import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';

const APP_ID = 'app-1';
const DEPLOYMENT_ID = 'deployment-1';
const FILESYSTEM_URL = `${ORIGIN}/api/apps/${APP_ID}/deployments/${DEPLOYMENT_ID}/filesystem`;

// A 401 rather than a 404 is what proves the route is mounted: an unmounted path under /api
// answers 404, so these assertions cover both the auth gate and the route tree.
describe('a deployment filesystem is read through the api that owns the app', () => {
  test('reading without a session is refused', async () => {
    expect((await send({ url: FILESYSTEM_URL })).status).toBe(StatusMap.Unauthorized);
  });

  // The path becomes part of a command the host's tooling tokenises the way a shell would, so a
  // traversal is refused at the edge rather than carried down for the agent to re-check.
  test('a path that walks upwards never reaches a host', async () => {
    const response = await send({ url: `${FILESYSTEM_URL}?path=/pb_data/../../etc` });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('nor does a relative one', async () => {
    const response = await send({ url: `${FILESYSTEM_URL}?path=pb_data` });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });
});
