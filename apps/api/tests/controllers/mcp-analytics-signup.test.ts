import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';

const { auth, AnalyticsServicePlugin } = await import('#services/plugins.ts');
const { MCP_RESOURCE, MCP_SCOPE } = await import('#lib/mcp/auth.ts');
const context = await auth.$context;
const provider = context.socialProviders.find((provider) => provider.id === 'github')!;
const analytics = AnalyticsServicePlugin.decorator.analyticsService;
const AUTH_URL = `${ORIGIN}/api/auth`;
const CALLBACK = 'https://mcp-client.example/callback';
const PKCE_VERIFIER_LENGTH = 64;

beforeEach(function githubProvider() {
  const id = crypto.randomUUID();
  spyOn(provider, 'validateAuthorizationCode').mockResolvedValue({ accessToken: 'private-token' });
  spyOn(provider, 'getUserInfo').mockResolvedValue({
    user: { email: `${id}@example.test`, name: 'Private name', emailVerified: true },
    data: { id },
  });
  spyOn(analytics, 'track').mockResolvedValue();
});

afterEach(function restoreMocks() {
  mock.restore();
});

async function signedMcpQuery(): Promise<string> {
  const registration = await sendJson({
    method: 'POST',
    url: `${AUTH_URL}/oauth2/register`,
    body: {
      client_name: 'analytics test',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: MCP_SCOPE,
    },
  });
  expect(registration.status).toBe(StatusMap.Created);
  const client = (await registration.json()) as Awaited<
    ReturnType<typeof auth.api.registerOAuthClient>
  >;
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: CALLBACK,
    response_type: 'code',
    scope: MCP_SCOPE,
    resource: MCP_RESOURCE.href,
    code_challenge: new Bun.CryptoHasher('sha256')
      .update('v'.repeat(PKCE_VERIFIER_LENGTH))
      .digest('base64url'),
    code_challenge_method: 'S256',
  });
  const response = await send({ url: `${AUTH_URL}/oauth2/authorize?${query}` });
  const login = new URL(response.headers.get('location')!, ORIGIN);
  expect(login.pathname).toBe('/login');
  return login.searchParams.toString();
}

async function githubSignIn({
  oauthQuery,
  doNotTrack = false,
  additionalData,
}: {
  oauthQuery?: string;
  doNotTrack?: boolean;
  additionalData?: Record<string, unknown>;
} = {}): Promise<Response> {
  const signIn = await sendJson({
    method: 'POST',
    url: `${AUTH_URL}/sign-in/social`,
    body: { provider: 'github', callbackURL: '/', oauth_query: oauthQuery, additionalData },
  });
  expect(signIn.status, await signIn.clone().text()).toBe(StatusMap.OK);
  const result = (await signIn.json()) as Awaited<ReturnType<typeof auth.api.signInSocial>>;
  const state = new URL(result.url!).searchParams.get('state')!;
  const cookie = signIn.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  return send({
    url: `${AUTH_URL}/callback/github?${new URLSearchParams({ state, code: 'private-code' })}`,
    headers: { cookie, ...(doNotTrack ? { dnt: '1' } : {}) },
  });
}

test('records an MCP signup only after a new GitHub account is created', async () => {
  const response = await githubSignIn({ oauthQuery: await signedMcpQuery() });
  expect(response.status).toBe(StatusMap.Found);
  expect(response.headers.get('set-cookie')).toContain('session_token');
  expect(analytics.track).toHaveBeenCalledTimes(1);
  expect(analytics.track).toHaveBeenCalledWith({
    ownerId: expect.any(String),
    event: { name: 'mcp_signup_completed', data: {} },
  });
});

test('does not count an existing account connecting MCP as a signup', async () => {
  const first = await githubSignIn();
  expect(first.headers.get('set-cookie')).toContain('session_token');
  const second = await githubSignIn({ oauthQuery: await signedMcpQuery() });
  expect(second.headers.get('set-cookie')).toContain('session_token');
  expect(analytics.track).not.toHaveBeenCalled();
});

test('does not count ordinary dashboard or anonymous signups as MCP signups', async () => {
  const response = await githubSignIn();
  expect(response.headers.get('set-cookie')).toContain('session_token');
  await auth.api.signInAnonymous();
  expect(analytics.track).not.toHaveBeenCalled();
});

test('does not trust client-supplied OAuth context for signup attribution', async () => {
  const response = await githubSignIn({
    additionalData: { serverContext: { query: await signedMcpQuery() } },
  });
  expect(response.headers.get('set-cookie')).toContain('session_token');
  expect(analytics.track).not.toHaveBeenCalled();
});

test('does not count a failed GitHub callback as a signup', async () => {
  spyOn(provider, 'validateAuthorizationCode').mockRejectedValue(new Error('invalid code'));
  const response = await githubSignIn({ oauthQuery: await signedMcpQuery() });
  expect(response.headers.get('location')).toContain('invalid_code');
  expect(analytics.track).not.toHaveBeenCalled();
});

test('respects Do Not Track on signup', async () => {
  const response = await githubSignIn({ oauthQuery: await signedMcpQuery(), doNotTrack: true });
  expect(response.headers.get('set-cookie')).toContain('session_token');
  expect(analytics.track).not.toHaveBeenCalled();
});
