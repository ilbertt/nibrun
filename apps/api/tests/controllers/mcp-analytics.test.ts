import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { decodeJwt } from 'jose';
import { mcpAnalyticsAuthFixture } from '#tests/controllers/support/mcp-analytics-auth.ts';

test('Better Auth confirms a real new-account MCP signup and resumes authorization at consent', async () => {
  const fixture = await mcpAnalyticsAuthFixture();
  const consent = await fixture.signIn();
  expect(consent.pathname).toBe('/consent');
  const signup = fixture.repository.events.find(({ event }) => event.name === 'sign_up_completed');
  expect(signup).toBeDefined();
  expect(signup?.attempt.accountId).toBeString();
  expect(
    fixture.repository.events.find(({ event }) => event.name === 'sign_in_completed')?.event.data,
  ).toMatchObject({ account_type: 'new' });

  const response = await fixture.request({
    path: '/oauth2/consent',
    body: { accept: true, oauth_query: consent.search.slice(1) },
  });
  expect(response.status, await response.clone().text()).toBe(StatusMap.OK);
  expect(fixture.repository.events.at(-1)?.event.name).toBe('mcp_authorization_completed');
  expect(fixture.repository.events.at(-1)?.attempt.accountId).toBe(signup?.attempt.accountId);
  const result = (await response.json()) as { url: string };
  const code = new URL(result.url).searchParams.get('code')!;
  const exchange = await fixture.exchange(code);
  expect(exchange.status, await exchange.clone().text()).toBe(StatusMap.OK);
  const tokens = (await exchange.json()) as { access_token: string };
  const claims = decodeJwt(tokens.access_token);
  const connection = {
    request: new Request('https://app.nibrun.com/mcp'),
    claims,
    response: Response.json({ result: {} }),
  };
  await fixture.analytics.connected(connection);
  await fixture.analytics.connected(connection);
  expect(
    fixture.repository.events.filter(({ event }) => event.name === 'mcp_connected'),
  ).toHaveLength(1);
  expect(fixture.repository.events.at(-1)?.attempt.accountId).toBe(signup?.attempt.accountId);
});

test('Better Auth does not count a new signup for a returning provider account', async () => {
  const fixture = await mcpAnalyticsAuthFixture();
  await fixture.context.internalAdapter.createUser(
    { name: 'Existing user', email: fixture.email, emailVerified: true },
    { method: 'admin' },
  );
  const consent = await fixture.signIn();
  expect(consent.pathname).toBe('/consent');
  expect(fixture.repository.events.some(({ event }) => event.name === 'sign_up_completed')).toBe(
    false,
  );
  expect(
    fixture.repository.events.find(({ event }) => event.name === 'sign_in_completed')?.event.data,
  ).toMatchObject({ account_type: 'existing' });
});
