/// <reference path="./vite-env.d.ts" />

import { UMAMI_WEBSITE_ID } from '#config.ts';
import { analyticsIdentity } from '#identity.ts';
import { analyticsPath, analyticsReferrer, analyticsSite } from '#page.ts';

type Payload = Record<string, unknown>;
type Tracker = {
  track(payload: (defaults: Payload) => Payload): Promise<void>;
  identify(data: { account_id: string }): Promise<void>;
};
type AnalyticsWindow = Window & {
  umami?: Tracker;
  nibrunBeforeSend?: typeof beforeSend;
};
let loading: Promise<boolean> | undefined;
let previousPage: URL | undefined;
let distinctId: string | undefined;
let accountId: string | undefined;

export function analyticsAccountId(): string | undefined {
  return accountId;
}

export function setAnalyticsAccountId(id: string | undefined): boolean {
  if (id === accountId) {
    return false;
  }
  accountId = id;
  void loadTracker()
    .then(async (loaded) => {
      if (loaded && accountId === id && trackingAllowed()) {
        await (window as AnalyticsWindow).umami?.identify({ account_id: id ?? '' });
      }
    })
    .catch(function ignoreAnalyticsFailure() {});
  return true;
}

export function trackingAllowed(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.parent === window &&
    window.location.protocol === 'https:' &&
    analyticsSite(window.location.hostname) !== undefined &&
    navigator.doNotTrack !== '1'
  );
}

export function loadTracker(): Promise<boolean> {
  if (!trackingAllowed()) {
    return Promise.resolve(false);
  }
  if (loading) {
    return loading;
  }
  loading = new Promise((resolve) => {
    const script = document.createElement('script');
    const hostname = import.meta.env.VITE_UMAMI_HOSTNAME;
    script.src = `https://${hostname}/script.js`;
    script.async = true;
    script.dataset.websiteId = UMAMI_WEBSITE_ID;
    script.dataset.beforeSend = 'nibrunBeforeSend';
    script.dataset.excludeSearch = 'true';
    script.dataset.excludeHash = 'true';
    script.dataset.doNotTrack = 'true';
    distinctId = analyticsIdentity();
    (window as AnalyticsWindow).nibrunBeforeSend = beforeSend;
    script.onload = () => {
      // Umami 3.4 observes pushState/replaceState but does not listen for popstate.
      window.addEventListener('popstate', syncHistoryTraversal);
      loadRecorder(hostname);
      resolve(true);
    };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loading;
}

function loadRecorder(hostname: string): void {
  if (!trackingAllowed()) {
    return;
  }
  const script = document.createElement('script');
  script.src = `https://${hostname}/recorder.js`;
  script.async = true;
  script.dataset.websiteId = UMAMI_WEBSITE_ID;
  document.head.appendChild(script);
}

function beforeSend(...[type, payload]: [string, Payload]): Payload | undefined {
  if ((type !== 'event' && type !== 'identify') || !trackingAllowed()) {
    return undefined;
  }
  const url = new URL(String(payload.url), window.location.href);
  const site = analyticsSite(url.hostname);
  if (!site) {
    return undefined;
  }
  if (type === 'event' && !payload.name) {
    if (previousPage?.origin === url.origin && previousPage.pathname === url.pathname) {
      return undefined;
    }
    previousPage = url;
  }
  return {
    ...payload,
    ...(type === 'identify' && { data: { account_id: accountId ?? '' } }),
    id: distinctId,
    url: `${url.origin}${analyticsPath({ site, pathname: url.pathname })}`,
    referrer: sanitizedReferrer(payload.referrer),
    title: `nibrun ${site}`,
  };
}

function sanitizedReferrer(referrer: unknown): string {
  return typeof referrer === 'string' && referrer
    ? analyticsReferrer(new URL(referrer, window.location.origin).href)
    : '';
}

function syncHistoryTraversal(): void {
  window.history.replaceState(window.history.state, '', window.location.href);
}

export function pagePayload(): Payload {
  return { url: window.location.href };
}

export function sendEvent(payload: Payload): Promise<void> {
  return (
    (window as AnalyticsWindow).umami?.track((defaults) => ({ ...defaults, ...payload })) ??
    Promise.resolve()
  );
}
