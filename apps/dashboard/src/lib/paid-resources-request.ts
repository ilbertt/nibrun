import { MAX_PAID_RESOURCE_AMOUNT } from '@repo/api-constants';
import type { PaidResourceAmounts } from '@repo/app-operations';

export type PaidResourceValues = { [Key in keyof PaidResourceAmounts]: string };

export const PAID_RESOURCE_LABELS = {
  requestedVcpuCount: 'Requested vCPUs',
  requestedMemoryMib: 'Requested RAM (MiB)',
  requestedVolumeGib: 'Requested volume (GiB)',
} satisfies Record<keyof PaidResourceAmounts, string>;

export function paidResourceAmounts(values: PaidResourceValues): PaidResourceAmounts | undefined {
  const amounts = {
    requestedVcpuCount: Number(values.requestedVcpuCount),
    requestedMemoryMib: Number(values.requestedMemoryMib),
    requestedVolumeGib: Number(values.requestedVolumeGib),
  };
  if (
    Object.values(values).some((value) => value.trim() === '') ||
    !Object.values(amounts).every(
      (amount) => Number.isInteger(amount) && amount > 0 && amount <= MAX_PAID_RESOURCE_AMOUNT,
    )
  ) {
    return undefined;
  }
  return amounts;
}
