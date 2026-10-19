import { expect, test } from 'bun:test';
import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';
import { paidAppsAmount } from '#lib/paid-apps-request.ts';

test('the form accepts a whole total at both ends of the supported range', () => {
  expect(paidAppsAmount(String(MIN_PAID_APPS_REQUEST))).toBe(MIN_PAID_APPS_REQUEST);
  expect(paidAppsAmount(String(MAX_PAID_APPS_REQUEST))).toBe(MAX_PAID_APPS_REQUEST);
  expect(paidAppsAmount(' 10 ')).toBe(10);
});

test.each(['', ' ', '0', '-1', '1.5', 'NaN', 'Infinity', 'ten', String(MAX_PAID_APPS_REQUEST + 1)])(
  'the form cannot submit %s as an app total',
  function invalidTotal(value) {
    expect(paidAppsAmount(value)).toBeUndefined();
  },
);
