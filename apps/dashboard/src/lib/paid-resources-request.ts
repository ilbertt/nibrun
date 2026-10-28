import type { PaidRequest } from '@repo/api-client/models';
import { MAX_PAID_RESOURCE_AMOUNT } from '@repo/api-constants';

export type PaidResourceAmounts = Omit<
  Extract<PaidRequest, { requestType: 'resources' }>,
  'requestType' | 'appId'
>;

export type PaidResourceValues = { [Key in keyof PaidResourceAmounts]: string };

export const PAID_RESOURCE_LABELS = {
  additionalVcpuCount: 'Additional vCPUs',
  additionalMemoryMib: 'Additional RAM (MiB)',
  additionalVolumeGib: 'Additional volume (GiB)',
} satisfies Record<keyof PaidResourceAmounts, string>;

export function paidResourceAmounts(values: PaidResourceValues): PaidResourceAmounts | undefined {
  const amounts = {
    additionalVcpuCount: Number(values.additionalVcpuCount),
    additionalMemoryMib: Number(values.additionalMemoryMib),
    additionalVolumeGib: Number(values.additionalVolumeGib),
  };
  if (
    Object.values(values).some((value) => value.trim() === '') ||
    !Object.values(amounts).every(
      (amount) => Number.isInteger(amount) && amount >= 0 && amount <= MAX_PAID_RESOURCE_AMOUNT,
    ) ||
    !Object.values(amounts).some((amount) => amount > 0)
  ) {
    return undefined;
  }
  return amounts;
}
