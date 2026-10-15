import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { registeredAccount } from '#tests/controllers/support/accounts.ts';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';

const { OAuthClientIconServicePlugin } = await import('#services/plugins.ts');
const service = OAuthClientIconServicePlugin.decorator.oauthClientIconService;
const WEBSITE = 'https://client.example/about?source=oauth';
const ENDPOINT = `${ORIGIN}/api/oauth/client-icon?${new URLSearchParams({ url: WEBSITE })}`;

afterEach(function restoreMocks() {
  mock.restore();
});

test('website icon lookup requires a registered account session', async () => {
  const discover = spyOn(service, 'discover');
  const response = await send({ url: ENDPOINT });
  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(discover).not.toHaveBeenCalled();
});

test('returns the declared icon for a signed-in consent page', async () => {
  const account = await registeredAccount();
  const discover = spyOn(service, 'discover').mockResolvedValue('https://cdn.example/brand.svg');
  const response = await send({ url: ENDPOINT, headers: { cookie: account.cookie } });
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual({ iconUrl: 'https://cdn.example/brand.svg' });
  expect(discover).toHaveBeenCalledWith({ url: WEBSITE });
});
