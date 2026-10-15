import { expect, test } from 'bun:test';
import { UMAMI_WEBSITE_ID } from '#config.ts';
import { serverEventPayload, serverTrackingAllowed } from '#server.ts';

const DASHBOARD_URL = new URL('https://app.nibrun.com');

test('backend events use the shared website and distinct identity with the known account', () => {
  const payload = serverEventPayload({
    event: {
      name: 'mcp_connected',
      data: { source: 'mcp', attempt_id: 'attempt', duration_ms: 1 },
    },
    identity: { distinctId: 'browser-id', userAgent: 'Mozilla/5.0' },
    accountId: 'account-id',
    identityState: 'with-account',
    url: new URL('/api/auth/callback/github?code=secret&state=secret', DASHBOARD_URL),
    pathname: '/mcp',
  });
  expect(payload).toMatchObject({
    type: 'event',
    payload: {
      website: UMAMI_WEBSITE_ID,
      id: 'browser-id',
      url: 'https://app.nibrun.com/dashboard/mcp',
      name: 'mcp_connected',
      data: {
        account_id: 'account-id',
        source: 'mcp',
        attempt_id: 'attempt',
        identity_state: 'with-account',
      },
    },
  });
  expect(JSON.stringify(payload)).not.toContain('secret');
});

test('backend tracking respects production, HTTPS, Do Not Track, and embedded-window restrictions', () => {
  expect(serverTrackingAllowed({ url: DASHBOARD_URL, headers: new Headers() })).toBe(true);
  for (const url of [
    'http://app.nibrun.com',
    'https://localhost',
    'https://nibrun.com',
    'https://app.nibrun.com.attacker.test',
  ]) {
    expect(serverTrackingAllowed({ url: new URL(url), headers: new Headers() })).toBe(false);
  }
  expect(serverTrackingAllowed({ url: DASHBOARD_URL, headers: new Headers({ dnt: '1' }) })).toBe(
    false,
  );
  expect(
    serverTrackingAllowed({
      url: DASHBOARD_URL,
      headers: new Headers({ 'sec-fetch-dest': 'iframe' }),
    }),
  ).toBe(false);
});
