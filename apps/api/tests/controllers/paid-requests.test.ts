import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { AppQuotaExceededError } from '#lib/app-quota.ts';
import { registeredAccount } from '#tests/controllers/support/accounts.ts';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const { auth, AppsServicePlugin, PaidRequestsServicePlugin } = await import('#services/plugins.ts');
const URL = `${ORIGIN}/api/paid-requests`;
const REQUEST = { requestType: 'apps' as const, requestedAppsAmount: 10 };
const APPS_ALLOWED = 3;

afterEach(function restoreMocks() {
  mock.restore();
});

test('paid requests require a registered account', async () => {
  expect(
    (
      await sendJson({
        method: 'PUT',
        url: `${URL}/apps`,
        body: { requestedAppsAmount: REQUEST.requestedAppsAmount },
      })
    ).status,
  ).toBe(StatusMap.Unauthorized);
  const anonymous = await auth.api.signInAnonymous({ returnHeaders: true });
  const headers = { authorization: `Bearer ${anonymous.response.token}` };
  expect(
    (
      await sendJson({
        method: 'PUT',
        url: `${URL}/apps`,
        body: { requestedAppsAmount: REQUEST.requestedAppsAmount },
        headers,
      })
    ).status,
  ).toBe(StatusMap.Forbidden);
});

test('saving a request uses the authenticated owner', async () => {
  const account = await registeredAccount();
  const headers = { cookie: account.cookie };
  const service = PaidRequestsServicePlugin.decorator.paidRequestsService;
  const save = spyOn(service, 'save').mockResolvedValue(REQUEST);
  const saved = await sendJson({
    method: 'PUT',
    url: `${URL}/apps`,
    body: { requestedAppsAmount: REQUEST.requestedAppsAmount },
    headers,
  });
  expect(saved.status).toBe(StatusMap.OK);
  expect(await saved.json()).toEqual(REQUEST);
  expect(save).toHaveBeenCalledWith({ ownerId: account.ownerId, request: REQUEST });
});

test('the API refuses unsupported types, invalid totals and owner spoofing', async () => {
  const account = await registeredAccount();
  const headers = { cookie: account.cookie };
  const save = spyOn(
    PaidRequestsServicePlugin.decorator.paidRequestsService,
    'save',
  ).mockResolvedValue(REQUEST);
  for (const body of [
    { requestedAppsAmount: 0 },
    { requestedAppsAmount: 101 },
    { requestedAppsAmount: 1.5 },
    { requestedAppsAmount: '10' },
    { requestedAppsAmount: null },
    {},
    { amount: 10 },
    { requestedAppsAmount: 10, ownerId: 'someone-else' },
  ]) {
    expect((await sendJson({ method: 'PUT', url: `${URL}/apps`, body, headers })).status).toBe(
      StatusMap['Bad Request'],
    );
  }
  expect(
    (
      await sendJson({
        method: 'PUT',
        url: `${URL}/custom-domain`,
        body: { requestedAppsAmount: 10 },
        headers,
      })
    ).status,
  ).toBe(StatusMap['Bad Request']);
  expect(save).not.toHaveBeenCalled();
});

test('a quota refusal carries the account limit and paid-app question', async () => {
  const account = await registeredAccount();
  const refusal = new AppQuotaExceededError(APPS_ALLOWED);
  spyOn(AppsServicePlugin.decorator.appsService, 'create').mockRejectedValue(refusal);
  const response = await sendJson({
    method: 'POST',
    url: `${ORIGIN}/api/apps`,
    body: { name: 'one-more' },
    headers: { cookie: account.cookie },
  });
  expect(response.status).toBe(StatusMap.Forbidden);
  expect(await response.json()).toEqual(refusal.response);
  expect(refusal.message).toContain('Paid apps are coming. How many apps do you need?');
});
