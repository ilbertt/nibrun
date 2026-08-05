import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const APPS_URL = `${ORIGIN}/api/apps`;
const APP_URL = `${APPS_URL}/app-1`;

const OWNED_ROUTES = [
  { method: 'GET', url: APPS_URL },
  { method: 'POST', url: APPS_URL, body: { name: 'pocketbase' } },
  { method: 'GET', url: APP_URL },
  { method: 'PATCH', url: APP_URL, body: {} },
  { method: 'DELETE', url: APP_URL },
];

describe('nothing under /api/apps answers a caller with no session', () => {
  test.each(OWNED_ROUTES)('$method $url is refused', async (route) => {
    // Unauthorized rather than Not Found: every route is mounted, each one refuses to serve.
    expect((await sendJson(route)).status).toBe(StatusMap.Unauthorized);
  });
});

// Elysia raises its own 422 for a schema violation; `elysiaErrorHandler` rewrites it, and a
// client reading the status would otherwise see two different codes for one kind of mistake.
describe('a malformed request is a bad request', () => {
  test('creating an app without naming it', async () => {
    const response = await sendJson({ method: 'POST', url: APPS_URL, body: { config: {} } });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('patching an app with a port that is not one', async () => {
    const response = await sendJson({ method: 'PATCH', url: APP_URL, body: { guestPort: 0 } });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // Every field is optional, so a misspelled one matches nothing and would otherwise be a 200
  // for an edit that never happened.
  test('patching an app with a field it does not have', async () => {
    const response = await sendJson({ method: 'PATCH', url: APP_URL, body: { guestport: 8080 } });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // Readable on the way out, refused on the way in: the api sizes the filesystem, so a caller
  // that thinks it can choose has to be told rather than quietly ignored.
  test('patching the volume size is refused, because the api owns it', async () => {
    const response = await sendJson({
      method: 'PATCH',
      url: APP_URL,
      body: { volumeSizeBytes: 1024 },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('creating an app with a field it does not have', async () => {
    const response = await sendJson({
      method: 'POST',
      url: APPS_URL,
      body: { name: 'pocketbase', regionn: 'eu' },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });
});
