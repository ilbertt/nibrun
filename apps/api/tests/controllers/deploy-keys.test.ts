import { describe, expect, spyOn, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, type Route, routesUnder, sendJson } from '#tests/controllers/support/api.ts';
import { DEPLOY_PUBLIC_KEY } from '#tests/support/deploy-key.ts';

const { auth } = await import('#services/plugins.ts');

const KEY_URL = `${ORIGIN}/api/apps/app-1/deploy-keys`;
const ADD_BODY = { name: 'GitHub Actions', publicKey: DEPLOY_PUBLIC_KEY };
const KEY_ROUTES = routesUnder('/api/apps').filter(({ path }) => path.includes('/deploy-keys'));

function requestFor({ method, path }: Route) {
  return {
    method,
    url: `${ORIGIN}${path.replace(':appId', 'app-1').replace(':deployKeyId', 'key-1')}`,
    body: method === 'POST' ? ADD_BODY : undefined,
  };
}

describe('deploy keys require an identified owner', () => {
  test('all three management endpoints are mounted', () => {
    const ROUTE_COUNT = 3;
    expect(KEY_ROUTES).toHaveLength(ROUTE_COUNT);
  });

  test.each(KEY_ROUTES)('$method $path refuses a caller without a session', async (route) => {
    expect((await sendJson(requestFor(route))).status).toBe(StatusMap.Unauthorized);
  });

  test.each(KEY_ROUTES)('$method $path refuses an anonymous session', async (route) => {
    const session = {
      user: { id: 'anonymous-owner', isAnonymous: true },
      session: {},
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>;
    const getSession = spyOn(auth.api, 'getSession').mockResolvedValue(session);
    try {
      expect((await sendJson(requestFor(route))).status).toBe(StatusMap.Forbidden);
    } finally {
      getSession.mockRestore();
    }
  });

  test.each([
    { ...ADD_BODY, name: '' },
    { ...ADD_BODY, name: '   ' },
    { ...ADD_BODY, privateKey: 'must-not-be-sent' },
    { publicKey: DEPLOY_PUBLIC_KEY },
  ])('refuses malformed registration requests', async (body) => {
    const response = await sendJson({ method: 'POST', url: KEY_URL, body });

    expect(response.status).toBe(StatusMap['Bad Request']);
    expect(await response.text()).not.toContain('must-not-be-sent');
  });
});
