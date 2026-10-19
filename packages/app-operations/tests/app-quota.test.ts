import { expect, test } from 'bun:test';
import type { AppQuotaExceeded } from '@repo/api-client/models';
import { ApiError } from '@repo/api-client/unwrap';
import { APP_QUOTA_EXCEEDED_CODE } from '@repo/api-constants';
import { appQuotaExceeded } from '#app-quota.ts';

const FORBIDDEN = 403;
const APPS_ALLOWED = 3;
const BODY: AppQuotaExceeded = {
  code: APP_QUOTA_EXCEEDED_CODE,
  error: 'App limit reached',
  appsAllowed: APPS_ALLOWED,
};

test('only a structured quota refusal is treated as the app limit', () => {
  expect(
    appQuotaExceeded(new ApiError({ message: 'refused', status: FORBIDDEN, body: BODY })),
  ).toEqual(BODY);
  for (const body of [
    null,
    {},
    { ...BODY, code: 'OTHER_ERROR' },
    { ...BODY, appsAllowed: -1 },
    { ...BODY, appsAllowed: 1.5 },
  ]) {
    expect(
      appQuotaExceeded(new ApiError({ message: 'refused', status: FORBIDDEN, body })),
    ).toBeUndefined();
  }
  expect(appQuotaExceeded(new Error('App limit reached'))).toBeUndefined();
  expect(
    appQuotaExceeded(new ApiError({ message: 'refused', status: 500, body: BODY })),
  ).toBeUndefined();
});
