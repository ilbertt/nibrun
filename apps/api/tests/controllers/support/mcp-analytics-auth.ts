import { StatusMap } from 'elysia';
import '#tests/controllers/support/api.ts';
import { expect } from 'bun:test';
import { DASHBOARD_SITE } from '@repo/global-constants';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { createAuth } from '#lib/auth/better-auth.ts';
import { env } from '#lib/env.ts';
import { McpAnalyticsService } from '#services/mcp-analytics.service.ts';
import { McpAnalyticsRecorder } from '#tests/support/mcp-analytics.ts';

const VERIFIER_LENGTH = 64;
const VERIFIER = 'v'.repeat(VERIFIER_LENGTH);
const CALLBACK = 'https://client.test/callback';

export async function mcpAnalyticsAuthFixture() {
  const repository = new McpAnalyticsRecorder();
  const analytics = new McpAnalyticsService({ repository, baseUrl: new URL(DASHBOARD_SITE.url) });
  const auth = createAuth({
    database: memoryAdapter({}),
    appsService: {
      claim: function claim() {
        return Promise.resolve();
      },
    },
    analytics,
  });
  const context = await auth.$context;
  const github = context.socialProviders.find((provider) => provider.id === 'github')!;
  const email = `${crypto.randomUUID()}@example.test`;
  github.validateAuthorizationCode = function validTestCode() {
    return Promise.resolve({ accessToken: 'test-provider-token' });
  };
  github.getUserInfo = function providerUser() {
    return Promise.resolve({
      user: { name: 'Test account', email, emailVerified: true },
      data: { id: email },
    });
  };
  const cookies = new Map<string, string>();

  async function request({
    path,
    body,
  }: {
    path: string;
    body: Record<string, unknown> | undefined;
  }): Promise<Response> {
    const response = await analytics.handleAuth({
      request: new Request(`${env.BASE_URL.origin}/api/auth${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
          'content-type':
            path === '/oauth2/token' ? 'application/x-www-form-urlencoded' : 'application/json',
          origin: env.BASE_URL.origin,
          accept: body ? 'application/json' : 'text/html',
          'sec-fetch-mode': body ? 'cors' : 'navigate',
        },
        body: body
          ? path === '/oauth2/token'
            ? new URLSearchParams(
                Object.entries(body).map(([key, value]): [string, string] => [key, String(value)]),
              )
            : JSON.stringify(body)
          : undefined,
      }),
      handler: auth.handler,
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, ...value] = cookie.split(';')[0]!.split('=');
      cookies.set(key!, value.join('='));
    }
    return response;
  }

  const registration = await request({
    path: '/oauth2/register',
    body: {
      client_name: 'Analytics test client',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'mcp offline_access',
    },
  });
  const client = (await registration.json()) as { client_id: string };
  expect(client.client_id).toBeString();

  async function signIn() {
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: CALLBACK,
      response_type: 'code',
      scope: 'mcp offline_access',
      state: crypto.randomUUID(),
      code_challenge: new Bun.CryptoHasher('sha256').update(VERIFIER).digest('base64url'),
      code_challenge_method: 'S256',
      resource: new URL('/mcp', env.BASE_URL).href,
    });
    const authorize = await request({ path: `/oauth2/authorize?${query}`, body: undefined });
    expect(authorize.status).toBe(StatusMap.Found);
    const login = new URL(authorize.headers.get('location')!, env.BASE_URL);
    expect(login.pathname).toBe('/login');
    const social = await request({
      path: '/sign-in/social',
      body: { provider: 'github', callbackURL: '/', oauth_query: login.search.slice(1) },
    });
    expect(social.status, await social.clone().text()).toBe(StatusMap.OK);
    const provider = new URL(((await social.json()) as { url: string }).url);
    const callback = await request({
      path: `/callback/github?code=test&state=${provider.searchParams.get('state')}`,
      body: undefined,
    });
    expect(callback.status, await callback.clone().text()).toBe(StatusMap.Found);
    return new URL(callback.headers.get('location')!, env.BASE_URL);
  }

  function exchange(code: string): Promise<Response> {
    return request({
      path: '/oauth2/token',
      body: {
        grant_type: 'authorization_code',
        code,
        client_id: client.client_id,
        redirect_uri: CALLBACK,
        code_verifier: VERIFIER,
        resource: new URL('/mcp', env.BASE_URL).href,
      },
    });
  }

  return { auth, analytics, repository, request, signIn, context, email, client, exchange };
}
