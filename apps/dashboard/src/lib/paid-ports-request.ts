import { MAX_PAID_RESOURCE_AMOUNT } from '@repo/api-constants';

export function paidPortsAmount(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 && amount <= MAX_PAID_RESOURCE_AMOUNT
    ? amount
    : undefined;
}
