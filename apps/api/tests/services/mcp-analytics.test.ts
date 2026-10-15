import { expect, test } from 'bun:test';
import { ANALYTICS_IDENTITY_COOKIE } from '@repo/analytics/config';
import { DASHBOARD_SITE } from '@repo/global-constants';
import { StatusMap } from 'elysia';
import { McpAnalyticsService } from '#services/mcp-analytics.service.ts';
import { McpAnalyticsFlow } from '#tests/support/mcp-analytics.ts';

test('a new MCP signup is confirmed by account creation and includes the account on subsequent events', async () => {
  const flow = new McpAnalyticsFlow();
  const distinctId = crypto.randomUUID();
  await flow.start({ cookie: `${ANALYTICS_IDENTITY_COOKIE}=${distinctId}` });
  await flow.signIn();
  await flow.callback({ created: true, signedIn: true });
  await flow.consent(true);
  await flow.token();
  await Promise.all([flow.connected(), flow.connected()]);

  expect(flow.repository.events.map(({ event }) => event.name)).toEqual([
    'mcp_auth_started',
    'sign_in_started',
    'sign_up_completed',
    'sign_in_completed',
    'mcp_authorization_completed',
    'mcp_connected',
  ]);
  for (const { event, attempt } of flow.repository.events) {
    expect(event.data).toMatchObject({ source: 'mcp', attempt_id: flow.attemptId });
    expect(attempt.distinctId).toBe(distinctId);
    if (event.name !== 'mcp_auth_started' && event.name !== 'sign_in_started') {
      expect(attempt.accountId).toBe('account-user');
    }
  }
  expect(
    flow.repository.events.find(({ event }) => event.name === 'sign_in_completed')?.event.data,
  ).toMatchObject({ account_type: 'new', previous_identity_state: 'anonymous' });
  const serialized = JSON.stringify(flow.repository.events);
  for (const secret of [
    'private-code',
    'private-token-id',
    'private-refresh-token',
    'private-client-state',
    'private-github-state',
    'private-error',
    'test-signature',
  ]) {
    expect(serialized).not.toContain(secret);
  }
});

test('an existing account login and an anonymous user upgrade do not imply signup', async () => {
  const flow = new McpAnalyticsFlow();
  await flow.start();
  await flow.signIn();
  await flow.callback({ created: false, signedIn: true });
  expect(flow.repository.events.some(({ event }) => event.name === 'sign_up_completed')).toBe(
    false,
  );
  expect(
    flow.repository.events.find(({ event }) => event.name === 'sign_in_completed')?.event.data,
  ).toMatchObject({ account_type: 'existing', previous_identity_state: 'anonymous' });
});

test('a failed OAuth callback has no successful sign-in or signup', async () => {
  const flow = new McpAnalyticsFlow();
  await flow.start();
  await flow.signIn();
  await flow.callback({ created: false, signedIn: false });
  expect(flow.repository.events.map(({ event }) => event.name)).toEqual([
    'mcp_auth_started',
    'sign_in_started',
    'sign_in_failed',
  ]);
  expect(flow.repository.events.at(-1)?.event.data).toMatchObject({
    phase: 'callback',
    error_code: 'access_denied',
  });
});

test('failed sign-in after a creation hook cannot count a rolled-back signup', async () => {
  const flow = new McpAnalyticsFlow();
  await flow.start();
  await flow.signIn();
  await flow.callback({ created: true, signedIn: false });
  expect(flow.repository.events.some(({ event }) => event.name === 'sign_up_completed')).toBe(
    false,
  );
});

test('explicitly refused consent is distinct from an authorization failure', async () => {
  const flow = new McpAnalyticsFlow();
  await flow.start();
  await flow.consent(false);
  expect(flow.repository.events.map(({ event }) => event.name)).toEqual([
    'mcp_auth_started',
    'mcp_authorization_denied',
  ]);
  expect(flow.repository.events.at(-1)?.attempt.accountId).toBe('account-user');
});

test('code exchange failures are attributed to the attempt and sanitized', async () => {
  const flow = new McpAnalyticsFlow();
  await flow.start();
  await flow.consent(true);
  const response = await flow.service.handleAuth({
    request: flow.request({
      path: '/oauth2/token',
      body: { code: 'private-code' },
      headers: undefined,
    }),
    handler: function tokenFailure() {
      return Promise.resolve(
        Response.json(
          { error: 'private-diagnostic', error_description: 'secret' },
          { status: 400 },
        ),
      );
    },
  });
  expect(response.status).toBe(StatusMap['Bad Request']);
  expect(flow.repository.events.at(-1)?.event).toMatchObject({
    name: 'mcp_authorization_failed',
    data: { phase: 'token', error_code: 'unknown', http_status: 400 },
  });
  expect(flow.repository.events.at(-1)?.attempt.accountId).toBe('account-user');
});

test('connection requires a successful authenticated MCP response for the same account', async () => {
  const flow = new McpAnalyticsFlow();
  await flow.start();
  await flow.consent(true);
  await flow.token();
  await flow.service.connected({
    request: new Request(`${DASHBOARD_SITE.url}/mcp`),
    claims: { sub: 'other-user', jti: 'private-token-id' },
    response: Response.json({ result: {} }),
  });
  await flow.service.connected({
    request: new Request(`${DASHBOARD_SITE.url}/mcp`),
    claims: { sub: 'account-user', jti: 'private-token-id' },
    response: new Response(null, { status: 401 }),
  });
  expect(flow.repository.events.some(({ event }) => event.name === 'mcp_connected')).toBe(false);
  await flow.connected();
  expect(flow.repository.events.at(-1)?.event.name).toBe('mcp_connected');
});

test.each<Record<string, string>>([{ dnt: '1' }, { 'sec-fetch-dest': 'iframe' }])(
  'tracking restrictions preserve auth behavior without collecting attempts: %j',
  async (headers) => {
    const flow = new McpAnalyticsFlow();
    const response = await flow.start(headers);
    expect(response.status).toBe(StatusMap.Found);
    expect(flow.repository.records.size).toBe(0);
    expect(flow.repository.events).toEqual([]);
    expect(response.headers.getSetCookie()).toEqual([]);
  },
);

test('expired attempts cannot produce connection events', async () => {
  const flow = new McpAnalyticsFlow();
  await flow.start();
  await flow.consent(true);
  await flow.token();
  flow.expire();
  await flow.connected();
  expect(flow.repository.events.some(({ event }) => event.name === 'mcp_connected')).toBe(false);
});

test('analytics storage failure does not change authentication responses', async () => {
  const flow = new McpAnalyticsFlow();
  flow.repository.write = function failStorage() {
    return Promise.reject(new Error('unavailable'));
  };
  const response = await flow.start();
  expect(response.status).toBe(StatusMap.Found);
});

test('refresh tokens retain the original funnel and connection is deduplicated after an API restart', async () => {
  const flow = new McpAnalyticsFlow();
  await flow.start();
  await flow.consent(true);
  await flow.token();
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: 'account-user', jti: 'refreshed-token-id' })).toString('base64url')}.test`;
  await flow.service.handleAuth({
    request: flow.request({
      path: '/oauth2/token',
      body: { grant_type: 'refresh_token', refresh_token: 'private-refresh-token' },
      headers: undefined,
    }),
    handler: function refreshedToken() {
      return Promise.resolve(
        Response.json({ access_token: token, refresh_token: 'rotated-private-refresh-token' }),
      );
    },
  });
  const restarted = new McpAnalyticsService({
    repository: flow.repository,
    baseUrl: new URL(DASHBOARD_SITE.url),
  });
  await restarted.connected({
    request: new Request(`${DASHBOARD_SITE.url}/mcp`),
    claims: { sub: 'account-user', jti: 'refreshed-token-id' },
    response: Response.json({ result: {} }),
  });
  await flow.connected();
  expect(flow.repository.events.filter(({ event }) => event.name === 'mcp_connected')).toHaveLength(
    1,
  );
  expect(flow.repository.events.at(-1)?.event.data).toMatchObject({ attempt_id: flow.attemptId });
});
