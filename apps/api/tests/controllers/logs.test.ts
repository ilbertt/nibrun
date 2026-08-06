import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';

const APP_ID = 'app-1';
const DEPLOYMENT_ID = 'deployment-1';
const LOGS_URL = `${ORIGIN}/api/apps/${APP_ID}/deployments/${DEPLOYMENT_ID}/logs`;

// A 401 rather than a 404 is what proves the route is mounted: an unmounted path under /api
// answers 404, so these assertions cover both the auth gate and the route tree.
describe('a deployment logs are read through the api that owns the app', () => {
  test('reading without a session is refused', async () => {
    expect((await send({ url: LOGS_URL })).status).toBe(StatusMap.Unauthorized);
  });

  // The timerange is turned into the instant a read starts from, so a value the schema does not
  // admit is refused here rather than carried down and asked of the store as a window.
  test('a timerange that is not a duration never reaches the store', async () => {
    const response = await send({ url: `${LOGS_URL}?timerange=forever` });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // A cursor comes back from a previous page, so one that is not an instant is a reader that
  // invented it rather than passed it back.
  test('a cursor that is not an instant never reaches the store', async () => {
    const response = await send({ url: `${LOGS_URL}?since=yesterday` });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });
});
