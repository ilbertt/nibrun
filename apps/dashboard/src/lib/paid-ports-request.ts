import { MAX_PAID_PORTS_REQUEST, MIN_PAID_PORTS_REQUEST } from '@repo/api-constants';

export function paidPortsAmount(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  const amount = Number(value);
  return Number.isInteger(amount) &&
    amount >= MIN_PAID_PORTS_REQUEST &&
    amount <= MAX_PAID_PORTS_REQUEST
    ? amount
    : undefined;
}
