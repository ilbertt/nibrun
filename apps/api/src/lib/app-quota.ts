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
    : `This account can have ${allowed} app${allowed === 1 ? '' : 's'}. Delete one to make room for another.`;
}
