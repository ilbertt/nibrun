import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { AppQuotaExceededError } from '#lib/app-quota.ts';
import { registeredAccount } from '#tests/controllers/support/accounts.ts';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const { auth, AppsServicePlugin, PaidRequestsServicePlugin } = await import('#services/plugins.ts');
const URL = `${ORIGIN}/api/paid-requests`;
const REQUEST = { requestType: 'apps' as const, amount: 10 };
const APPS_ALLOWED = 3;

afterEach(function restoreMocks() {
  mock.restore();
});

test('paid requests require a registered account', async () => {
  expect(
    (await sendJson({ method: 'PUT', url: `${URL}/apps`, body: { amount: REQUEST.amount } }))
      .status,
  ).toBe(StatusMap.Unauthorized);
  const anonymous = await auth.api.signInAnonymous({ returnHeaders: true });
  const headers = { authorization: `Bearer ${anonymous.response.token}` };
  expect(
    (
      await sendJson({
        method: 'PUT',
        url: `${URL}/apps`,
        body: { amount: REQUEST.amount },
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
    body: { amount: REQUEST.amount },
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
    { amount: 0 },
    { amount: 101 },
    { amount: 1.5 },
    { amount: '10' },
    { amount: null },
    {},
    { amount: 10, ownerId: 'someone-else' },
  ]) {
    expect((await sendJson({ method: 'PUT', url: `${URL}/apps`, body, headers })).status).toBe(
      StatusMap['Bad Request'],
    );
  }
  expect(
    (await sendJson({ method: 'PUT', url: `${URL}/custom-domain`, body: { amount: 10 }, headers }))
      .status,
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
