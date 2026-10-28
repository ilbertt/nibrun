import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { MAX_PAID_RESOURCE_AMOUNT } from '@repo/api-constants';
import { StatusMap } from 'elysia';
import { AppQuotaExceededError } from '#lib/app-quota.ts';
import { NotFoundError } from '#lib/errors.ts';
import { registeredAccount } from '#tests/controllers/support/accounts.ts';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';
import {
  APP_PAID_REQUESTS,
  CUSTOM_BUCKET_REQUEST,
  paidRequestBody,
  RESOURCES_REQUEST,
} from '#tests/support/paid-requests.ts';

const { auth, AppsServicePlugin, PaidRequestsServicePlugin } = await import('#services/plugins.ts');
const URL = `${ORIGIN}/api/paid-requests`;
const REQUEST = { requestType: 'apps' as const, requestedAppsAmount: 10 };
const APPS_ALLOWED = 3;
const FRACTIONAL_RESOURCE_AMOUNT = 1.5;

afterEach(function restoreMocks() {
  mock.restore();
});

test.each(['apps', ...APP_PAID_REQUESTS.map((request) => request.requestType)])(
  'paid %s requests require a registered account',
  async (requestType) => {
    const body =
      requestType === 'apps'
        ? { requestedAppsAmount: REQUEST.requestedAppsAmount }
        : paidRequestBody(
            APP_PAID_REQUESTS.find((request) => request.requestType === requestType)!,
          );
    expect(
      (
        await sendJson({
          method: 'PUT',
          url: `${URL}/${requestType}`,
          body,
        })
      ).status,
    ).toBe(StatusMap.Unauthorized);
    const anonymous = await auth.api.signInAnonymous({ returnHeaders: true });
    const headers = { authorization: `Bearer ${anonymous.response.token}` };
    expect(
      (
        await sendJson({
          method: 'PUT',
          url: `${URL}/${requestType}`,
          body,
          headers,
        })
      ).status,
    ).toBe(StatusMap.Forbidden);
  },
);

test.each(APP_PAID_REQUESTS)(
  'a $requestType request includes its app and authenticated owner',
  async (request) => {
    const account = await registeredAccount();
    const save = spyOn(
      PaidRequestsServicePlugin.decorator.paidRequestsService,
      'save',
    ).mockResolvedValue(request);
    const response = await sendJson({
      method: 'PUT',
      url: `${URL}/${request.requestType}`,
      body: paidRequestBody(request),
      headers: { cookie: account.cookie },
    });
    expect(response.status).toBe(StatusMap.OK);
    expect(await response.json()).toEqual(request);
    expect(save).toHaveBeenCalledWith({ ownerId: account.ownerId, request });
  },
);

test.each(APP_PAID_REQUESTS)(
  'a $requestType request refuses app counts, credentials and owner spoofing',
  async (request) => {
    const account = await registeredAccount();
    const save = spyOn(PaidRequestsServicePlugin.decorator.paidRequestsService, 'save');
    for (const body of [
      {},
      { appId: null },
      { appId: '' },
      { appId: 123 },
      { ...paidRequestBody(request), requestedAppsAmount: 10 },
      { ...paidRequestBody(request), ownerId: 'someone-else' },
      { ...paidRequestBody(request), bucket: 'customer-data', secretAccessKey: 'private' },
    ]) {
      const response = await sendJson({
        method: 'PUT',
        url: `${URL}/${request.requestType}`,
        body,
        headers: { cookie: account.cookie },
      });
      expect(response.status).toBe(StatusMap['Bad Request']);
    }
    expect(save).not.toHaveBeenCalled();
  },
);

test.each(APP_PAID_REQUESTS)(
  'a $requestType request cannot distinguish missing apps from apps owned by someone else',
  async (request) => {
    const account = await registeredAccount();
    spyOn(PaidRequestsServicePlugin.decorator.paidRequestsService, 'save').mockRejectedValue(
      new NotFoundError(),
    );
    const response = await sendJson({
      method: 'PUT',
      url: `${URL}/${request.requestType}`,
      body: paidRequestBody(request),
      headers: { cookie: account.cookie },
    });
    expect(response.status).toBe(StatusMap['Not Found']);
  },
);

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

test.each(['additionalVcpuCount', 'additionalMemoryMib', 'additionalVolumeGib'])(
  'resource requests validate %s as a required nonnegative whole amount',
  async (field) => {
    const account = await registeredAccount();
    const save = spyOn(PaidRequestsServicePlugin.decorator.paidRequestsService, 'save');
    for (const amount of [
      undefined,
      null,
      -1,
      FRACTIONAL_RESOURCE_AMOUNT,
      '1',
      MAX_PAID_RESOURCE_AMOUNT + 1,
    ]) {
      const response = await sendJson({
        method: 'PUT',
        url: `${URL}/resources`,
        body: { ...paidRequestBody(RESOURCES_REQUEST), [field]: amount },
        headers: { cookie: account.cookie },
      });
      expect(response.status).toBe(StatusMap['Bad Request']);
    }
    expect(save).not.toHaveBeenCalled();
  },
);

test('all-zero resource amounts return a client error', async () => {
  const account = await registeredAccount();
  const response = await sendJson({
    method: 'PUT',
    url: `${URL}/resources`,
    body: {
      appId: RESOURCES_REQUEST.appId,
      additionalVcpuCount: 0,
      additionalMemoryMib: 0,
      additionalVolumeGib: 0,
    },
    headers: { cookie: account.cookie },
  });
  expect(response.status).toBe(StatusMap['Bad Request']);
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
    { requestedAppsAmount: 10, appId: CUSTOM_BUCKET_REQUEST.appId },
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
