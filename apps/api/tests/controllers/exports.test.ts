import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const APP_ID = 'app-1';
const EXPORT_ID = 'export-1';
const EXPORTS_URL = `${ORIGIN}/api/apps/${APP_ID}/exports`;

/**
 * A 401 rather than a 404 is what proves the route is mounted: an unmounted path under /api
 * answers 404, so these assertions cover both the auth gate and the route tree.
 *
 * An export carries the tenant's whole dataset, so the gate is the point — there is no shape of
 * this request that an anonymous caller should get an answer to.
 */
describe('an export is of an app, and an app belongs to someone', () => {
  test('listing them without a session is refused', async () => {
    expect((await sendJson({ url: EXPORTS_URL })).status).toBe(StatusMap.Unauthorized);
  });

  test('asking for one is refused', async () => {
    const response = await sendJson({ method: 'POST', url: EXPORTS_URL });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  // The route a client polls, and the only one that ever carries a download URL.
  test('polling one is refused', async () => {
    const response = await sendJson({ url: `${EXPORTS_URL}/${EXPORT_ID}` });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });
});
