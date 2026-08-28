import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const APPS_URL = `${ORIGIN}/api/apps`;
const APP_URL = `${APPS_URL}/app-1`;

// Well-formed on its own terms, so what refuses it is the api owning the field rather than the
// value being wrong.
const A_HEALTH_CHECK = {
  intervalMs: 1_000,
  timeoutMs: 500,
  gracePeriodMs: 10_000,
  healthyThreshold: 1,
  unhealthyThreshold: 3,
};

const A_RESTART_POLICY = {
  maxRestarts: 100,
  initialBackoffMs: 500,
  maxBackoffMs: 30_000,
  backoffFactor: 2,
  resetAfterMs: 60_000,
};

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
    const response = await sendJson({ method: 'PATCH', url: APP_URL, body: { httpPort: 0 } });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // Every field is optional, so a misspelled one matches nothing and would otherwise be a 200
  // for an edit that never happened.
  test('patching an app with a field it does not have', async () => {
    const response = await sendJson({ method: 'PATCH', url: APP_URL, body: { httpport: 8080 } });

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

  // The guest is what substitutes a value naming a runtime one, and a name it does not offer
  // fails the boot rather than reaching the binary — so the api is where a typo is still an
  // answer to whoever made it.
  test('patching a variable that names a runtime value the guest does not offer', async () => {
    const response = await sendJson({
      method: 'PATCH',
      url: APP_URL,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the syntax being validated, not an interpolation
      body: { environment: { URL: 'https://${NIBRUN_SLUG}/x' } },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // Elysia serialises the whole request body into its validation message, and a body now carries
  // an app's environment. A mistyped port must not answer with the secrets sent beside it.
  test('a refused request does not carry back what was sent with it', async () => {
    const response = await sendJson({
      method: 'PATCH',
      url: APP_URL,
      body: { environment: { TOKEN: 'sk-must-not-come-back' }, httpPort: 0 },
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

  // The rest of the machine is the api's to size for the same reason the filesystem is, and a
  // request asking for a bigger one has to be told so rather than answered 200 by a schema that
  // dropped the field.
  test('patching the machine resources is refused, because the api owns them', async () => {
    const response = await sendJson({
      method: 'PATCH',
      url: APP_URL,
      body: { resources: { vcpuCount: 4, memoryMib: 4096 } },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // A TCP connect to `PORT` is the whole probe, and how often it runs and how many failures
  // condemn an instance are nibrun's to decide — an app that could set its own thresholds could
  // also make itself unkillable.
  test('patching the health check is refused, because the api owns it', async () => {
    const response = await sendJson({
      method: 'PATCH',
      url: APP_URL,
      body: { healthCheck: { ...A_HEALTH_CHECK, path: '/healthz' } },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // A tenant that set its own budget could ask to be restarted forever, and an app that crashes
  // on every boot would then be a host's problem rather than its owner's.
  test('patching the restart policy is refused, because the api owns it', async () => {
    const response = await sendJson({
      method: 'PATCH',
      url: APP_URL,
      body: { restartPolicy: A_RESTART_POLICY },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('creating an app that asks for its own machine resources', async () => {
    const response = await sendJson({
      method: 'POST',
      url: APPS_URL,
      body: { name: 'pocketbase', config: { resources: { vcpuCount: 4, memoryMib: 4096 } } },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('creating an app that asks for its own health check', async () => {
    const response = await sendJson({
      method: 'POST',
      url: APPS_URL,
      body: { name: 'pocketbase', config: { healthCheck: A_HEALTH_CHECK } },
    });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('creating an app that asks for its own restart policy', async () => {
    const response = await sendJson({
      method: 'POST',
      url: APPS_URL,
      body: { name: 'pocketbase', config: { restartPolicy: A_RESTART_POLICY } },
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
