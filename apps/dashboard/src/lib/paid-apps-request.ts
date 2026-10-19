import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';

export function paidAppsAmount(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  const amount = Number(value);
  return Number.isInteger(amount) &&
    amount >= MIN_PAID_APPS_REQUEST &&
    amount <= MAX_PAID_APPS_REQUEST
    ? amount
    : undefined;
}
