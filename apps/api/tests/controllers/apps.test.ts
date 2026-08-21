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
  { method: 'PUT', url: `${APP_URL}/state`, body: { state: 'suspended' } },
  { method: 'DELETE', url: APP_URL },
];

describe('nothing under /api/apps answers a caller with no session', () => {
  test.each(OWNED_ROUTES)('$method $url is refused', async (route) => {
    // Unauthorized rather than Not Found: every route is mounted, each one refuses to serve.
    expect((await sendJson(route)).status).toBe(StatusMap.Unauthorized);
  });

  // A path segment is a plain string until a handler parses it, so a malformed one is refused
  // for the session it lacks rather than for its shape — which is the order a stranger should
  // meet: whether the id was well-formed is not something an unauthenticated caller learns.
  test('an appId the schema would refuse is still refused for the session first', async () => {
    const response = await sendJson({ method: 'GET', url: `${APPS_URL}/-not-an-app-id` });

    expect(response.status).toBe(StatusMap.Unauthorized);
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

  // TypeBox treats a key the pattern does not match as no part of the record at all, so without
  // the schema being closed this is a 200 for a variable that was never stored.
  test('patching an environment variable a shell would not accept either', async () => {
    const response = await sendJson({
      method: 'PATCH',
      url: APP_URL,
      body: { environment: { 'NOT-A-NAME': 'x' } },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // Elysia serialises the whole request body into its validation message, and a body now carries
  // an app's environment. A mistyped port must not answer with the secrets sent beside it.
  test('a refused request does not carry back what was sent with it', async () => {
    const response = await sendJson({
      method: 'PATCH',
      url: APP_URL,
      body: { environment: { TOKEN: 'sk-must-not-come-back' }, guestPort: 0 },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
    expect(await response.text()).not.toContain('sk-must-not-come-back');
  });

  // Readable on the way out, refused on the way in: the api sizes the filesystem, so a caller
  // that thinks it can choose has to be told rather than quietly ignored.
  // `deleting` and `deleted` are states an app is put in by being deleted and by a host saying
  // its filesystem is gone. Accepting either here would be a deletion asked for by the wrong
  // route, or an app calling itself gone while its bytes are still on a disk somewhere.
  test.each(['deleting', 'deleted', 'paused'])('asking for the %s state', async (state) => {
    const response = await sendJson({
      method: 'PUT',
      url: `${APP_URL}/state`,
      body: { state },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

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
