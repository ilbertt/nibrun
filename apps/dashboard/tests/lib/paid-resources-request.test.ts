import { expect, test } from 'bun:test';
import { MAX_PAID_RESOURCE_AMOUNT } from '@repo/api-constants';
import { type PaidResourceValues, paidResourceAmounts } from '#lib/paid-resources-request.ts';

const VALUES: PaidResourceValues = {
  requestedVcpuCount: '1',
  requestedMemoryMib: '512',
  requestedVolumeGib: '16',
};

test('the form preserves separate amounts and units for all three resources', () => {
  expect(paidResourceAmounts(VALUES)).toEqual({
    requestedVcpuCount: 1,
    requestedMemoryMib: 512,
    requestedVolumeGib: 16,
  });
});

test.each(Object.keys(VALUES) as (keyof PaidResourceValues)[])(
  '%s can change while the other resource totals stay the same',
  (resource) => {
    const totals = paidResourceAmounts(VALUES)!;
    const requested = Number(VALUES[resource]) * 2;
    expect(paidResourceAmounts({ ...VALUES, [resource]: String(requested) })).toEqual({
      ...totals,
      [resource]: requested,
    });
  },
);

test.each([
  '',
  ' ',
  '0',
  '-1',
  '1.5',
  'NaN',
  'Infinity',
  'ten',
  String(MAX_PAID_RESOURCE_AMOUNT + 1),
])('an invalid amount %s prevents submitting any resource', (value) => {
  for (const resource of Object.keys(VALUES)) {
    expect(paidResourceAmounts({ ...VALUES, [resource]: value })).toBeUndefined();
  }
});
