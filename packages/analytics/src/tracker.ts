import { DEFAULT_UMAMI_HOSTNAME, UMAMI_WEBSITE_ID } from '#config.ts';
import { analyticsIdentity } from '#identity.ts';
import { analyticsPath, analyticsReferrer, analyticsSite } from '#page.ts';

type Payload = Record<string, unknown>;
type Tracker = { track(payload: (defaults: Payload) => Payload): Promise<void> };
type AnalyticsWindow = Window & { umami?: Tracker };
let loading: Promise<boolean> | undefined;
let previousUrl: string | undefined;
let previousPathname: string | undefined;
let referrer: string | undefined;
let distinctId: string | undefined;

export function loadTracker(hostname: string | undefined): Promise<boolean> {
  if (
    window.parent !== window ||
    window.location.protocol !== 'https:' ||
    !analyticsSite(window.location.hostname) ||
    navigator.doNotTrack === '1'
  ) {
    return Promise.resolve(false);
  }
  if (loading) {
    return loading;
  }
  loading = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `https://${hostname || DEFAULT_UMAMI_HOSTNAME}/script.js`;
    script.async = true;
    script.dataset.websiteId = UMAMI_WEBSITE_ID;
    script.dataset.autoTrack = 'false';
    script.dataset.doNotTrack = 'true';
    distinctId = analyticsIdentity();
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loading;
}

export function trackPage(pathname: string): void {
  const site = analyticsSite(window.location.hostname);
  const tracker = (window as AnalyticsWindow).umami;
  if (!site || !tracker) {
    return;
  }
  const url = `${window.location.origin}${analyticsPath({ site, pathname })}`;
  if (pathname === previousPathname) {
    return;
  }
  referrer = previousUrl ?? analyticsReferrer(document.referrer);
  previousUrl = url;
  previousPathname = pathname;
  void tracker.track((defaults) => ({
    ...defaults,
    id: distinctId,
    url,
    referrer,
    title: `nibrun ${site}`,
  }));
}
