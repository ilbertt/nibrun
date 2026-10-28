import { expect, test } from 'bun:test';
import { MAX_PAID_RESOURCE_AMOUNT } from '@repo/api-constants';
import { type PaidResourceValues, paidResourceAmounts } from '#lib/paid-resources-request.ts';

const VALUES: PaidResourceValues = {
  additionalVcpuCount: '2',
  additionalMemoryMib: '512',
  additionalVolumeGib: '16',
};

test('the form preserves separate amounts and units for all three resources', () => {
  expect(paidResourceAmounts(VALUES)).toEqual({
    additionalVcpuCount: 2,
    additionalMemoryMib: 512,
    additionalVolumeGib: 16,
  });
});

test.each(Object.keys(VALUES) as (keyof PaidResourceValues)[])(
  '%s can be the only resource increased',
  (resource) => {
    const values = {
      additionalVcpuCount: '0',
      additionalMemoryMib: '0',
      additionalVolumeGib: '0',
      [resource]: '1',
    };
    expect(paidResourceAmounts(values)).toEqual({
      additionalVcpuCount: 0,
      additionalMemoryMib: 0,
      additionalVolumeGib: 0,
      [resource]: 1,
    });
  },
);

test('the form requires at least one positive amount', () => {
  expect(
    paidResourceAmounts({
      additionalVcpuCount: '0',
      additionalMemoryMib: '0',
      additionalVolumeGib: '0',
    }),
  ).toBeUndefined();
});

test.each(['', ' ', '-1', '1.5', 'NaN', 'Infinity', 'ten', String(MAX_PAID_RESOURCE_AMOUNT + 1)])(
  'an invalid amount %s prevents submitting any resource',
  (value) => {
    for (const resource of Object.keys(VALUES)) {
      expect(paidResourceAmounts({ ...VALUES, [resource]: value })).toBeUndefined();
    }
  },
);
