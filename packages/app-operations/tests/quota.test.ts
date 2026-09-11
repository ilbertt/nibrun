import { expect, test } from 'bun:test';
import { ApiError, ApiRefusal } from '@repo/api-client/unwrap';
import { appQuotaRefusal } from '#quota.ts';

const OVER_QUOTA = { error: 'This account can have 3 apps.', appsAllowed: 3 };

test('a refusal naming the number is the account at its limit', () => {
  const failure = new ApiRefusal({ status: '403', body: OVER_QUOTA });

  expect(appQuotaRefusal(failure)).toEqual(OVER_QUOTA);
});

test('a refusal with only a sentence is not', () => {
  const failure = new ApiRefusal({ status: '403', body: { error: 'Forbidden' } });

  expect(appQuotaRefusal(failure)).toBeUndefined();
});

test('a failure the api never answered is not', () => {
  expect(appQuotaRefusal(new ApiError('Unable to connect'))).toBeUndefined();
  expect(appQuotaRefusal(new Error('boom'))).toBeUndefined();
});
