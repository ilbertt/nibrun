import { APP_QUOTA_EXCEEDED_CODE } from '@repo/api-constants';
import type { AppQuotaExceededResponse } from '#lib/api/app-quota.ts';
import { ForbiddenError } from '#lib/errors.ts';

export class AppQuotaExceededError extends ForbiddenError {
  readonly appsAllowed: number;

  constructor(allowed: number) {
    super(overAppQuota(allowed));
    this.appsAllowed = allowed;
  }

  override get response(): AppQuotaExceededResponse {
    return { error: this.message, code: APP_QUOTA_EXCEEDED_CODE, appsAllowed: this.appsAllowed };
  }
}

/**
 * Names the limit rather than the shortfall: someone reading this is looking at a number they did
 * not choose and cannot see anywhere else, and "you have 3" answers that where "you have 0 left"
 * only restates the refusal.
 *
 * The number is the database's — `nibrun.app_quotas` carries the default and any grant over
 * it — so nothing here states one. A constant beside the view would be a second place to change
 * the free tier, which is a second place to forget.
 */
export function overAppQuota(allowed: number): string {
  return allowed === 0
    ? 'This account cannot create apps.'
    : `This account can have ${allowed} app${allowed === 1 ? '' : 's'}. Paid apps are coming. How many apps do you need?`;
}
