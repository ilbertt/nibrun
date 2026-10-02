import { readEntry } from '#entry.ts';
import type { AnalyticsEvent } from '#events.ts';
import { analyticsSite } from '#page.ts';
import { loadTracker, pagePayload, sendEvent, trackingAllowed } from '#tracker.ts';

export function trackEvent({ name, data }: AnalyticsEvent): void {
  if (!trackingAllowed()) {
    return;
  }
  const page = pagePayload();
  const properties = {
    ...readEntry(),
    site: analyticsSite(window.location.hostname),
    identity_state: 'unknown',
    ...data,
  };
  void loadTracker()
    .then(async (loaded) => {
      if (loaded) {
        await sendEvent({ ...page, name, data: properties });
      }
    })
    .catch(function ignoreAnalyticsFailure() {});
}
