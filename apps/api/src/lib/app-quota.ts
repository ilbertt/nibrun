import { HELLO_EMAIL } from '@repo/global-constants';
import type { AppQuotaRefusal } from '@repo/protocol';
import { ForbiddenError } from '#lib/errors.ts';

/**
 * Names the limit rather than the shortfall: someone reading this is looking at a number they did
 * not choose and cannot see anywhere else, and "you have 3" answers that where "you have 0 left"
 * only restates the refusal.
 *
 * The number is the database's — `nibrun.app_quotas` carries the default and any grant over
 * it — so nothing here states one. A constant beside the view would be a second place to change
 * the free tier, which is a second place to forget.
 *
 * Carried in the body as well as read into the sentence, for the client that can open the email
 * already written rather than name the address.
 */
export class AppQuotaError extends ForbiddenError {
  readonly appsAllowed: number;

  constructor(appsAllowed: number) {
    super(overAppQuota(appsAllowed));
    this.name = 'AppQuotaError';
    this.appsAllowed = appsAllowed;
  }

  override body(): AppQuotaRefusal {
    return { error: this.message, appsAllowed: this.appsAllowed };
  }
}

function overAppQuota(allowed: number): string {
  return allowed === 0
    ? 'This account cannot create apps.'
    : `This account can have ${allowed} app${allowed === 1 ? '' : 's'}. Delete one to make room for another, or send an email to ${HELLO_EMAIL} to ask for more.`;
}
