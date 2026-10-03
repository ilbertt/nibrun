/** biome-ignore-all lint/performance/noBarrelFile: index is the only allowed file where we can export other files */

export { type AnalyticsEntry, readEntry, recordEntry } from '#entry.ts';
export type { AnalyticsEvent, AnalyticsEventData, DeploymentContext } from '#events.ts';
export { SIGN_IN_REASONS } from '#events.ts';
export { analyticsIdentityState, setAnalyticsIdentityState, trackEvent } from '#track-event.ts';
export { setAnalyticsAccountId, trackingAllowed } from '#tracker.ts';
export { useAnalytics } from '#use-analytics.ts';
