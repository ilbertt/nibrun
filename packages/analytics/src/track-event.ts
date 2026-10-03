import { readEntry } from '#entry.ts';
import type { AnalyticsEvent } from '#events.ts';
import { analyticsSite } from '#page.ts';
import {
  analyticsAccountId,
  loadTracker,
  pagePayload,
  sendEvent,
  trackingAllowed,
} from '#tracker.ts';

let identityState = 'unknown';

export function analyticsIdentityState(): string {
  return identityState;
}

export function setAnalyticsIdentityState(identity: string): boolean {
  if (identity === identityState) {
    return false;
  }
  identityState = identity;
  return true;
}

export function trackEvent({ name, data }: AnalyticsEvent): void {
  if (!trackingAllowed()) {
    return;
  }
  const page = pagePayload();
  const entry = readEntry();
  const properties = {
    ...entry,
    entry_preset_slug: entry.preset_slug,
    site: analyticsSite(window.location.hostname),
    identity_state: identityState,
    ...data,
    account_id: analyticsAccountId(),
  };
  void loadTracker()
    .then(async (loaded) => {
      if (loaded) {
        await sendEvent({ ...page, name, data: properties });
      }
    })
    .catch(function ignoreAnalyticsFailure() {});
}
