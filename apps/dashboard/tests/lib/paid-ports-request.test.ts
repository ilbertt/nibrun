import { expect, test } from 'bun:test';
import { MAX_PAID_PORTS_REQUEST } from '@repo/api-constants';
import { paidPortsAmount } from '#lib/paid-ports-request.ts';

test.each(['1', '3', ' 5 '])('a whole port total of %s can be submitted', (value) => {
  expect(paidPortsAmount(value)).toBe(Number(value));
});

test.each([
  '',
  ' ',
  '0',
  '-1',
  '1.5',
  'NaN',
  'Infinity',
  'two',
  String(MAX_PAID_PORTS_REQUEST + 1),
])('invalid port total %s cannot be submitted', (value) => {
  expect(paidPortsAmount(value)).toBeUndefined();
});
