import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';

const APP_ID = 'app-1';
const DEPLOYMENT_ID = 'deployment-1';
const LOGS_URL = `${ORIGIN}/api/apps/${APP_ID}/deployments/${DEPLOYMENT_ID}/logs`;

// A 401 rather than a 404 is what proves the route is mounted: an unmounted path under /api
// answers 404, so these assertions cover both the auth gate and the route tree.
describe('a deployment logs are read through the api that owns the app', () => {
  test('tailing without a session is refused', async () => {
    expect((await send({ url: LOGS_URL })).status).toBe(StatusMap.Unauthorized);
  });

  // The offset reaches the store inside a LogsQL query, so a value the schema does not admit is
  // refused here rather than carried down and rejected as a syntax error by the store.
  test('a start offset that is not a duration never reaches the store', async () => {
    const response = await send({ url: `${LOGS_URL}?startOffset=forever` });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });
});
