import { afterAll, expect, test } from 'bun:test';
import { readEntry, recordEntry } from '#entry.ts';
import { analyticsIdentity } from '#identity.ts';
import { setAnalyticsIdentityState, trackEvent } from '#track-event.ts';
import { loadTracker, setAnalyticsAccountId } from '#tracker.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalUmamiHostname = process.env.VITE_UMAMI_HOSTNAME;
process.env.VITE_UMAMI_HOSTNAME = 'analytics.example';
let cookie = '';
let cookieWrite = '';
const scripts: HTMLScriptElement[] = [];
const events: Record<string, unknown>[] = [];
const identifications: Record<string, unknown>[] = [];
const listeners = new Map<string, EventListener>();
const EXPECTED_PAGEVIEWS = 4;
const browser = {
  location: {
    protocol: 'https:',
    hostname: 'nibrun.com',
    origin: 'https://nibrun.com',
    href: 'https://nibrun.com/',
  },
  parent: undefined as unknown,
  nibrunBeforeSend: undefined as
    | ((type: string, payload: Record<string, unknown>) => Record<string, unknown> | undefined)
    | undefined,
  addEventListener(...[type, listener]: [string, EventListener]) {
    listeners.set(type, listener);
  },
  history: {
    state: { __TSR_key: 'preserved-key' },
    replaceState(...[state, , url]: [unknown, string, string]) {
      expect(state).toBe(browser.history.state);
      nativeTrack({ ...nativePayload(url), referrer: '/apps/another-private-id/logs' });
    },
  },
  umami: {
    identify(data: { account_id: string }): Promise<void> {
      const sanitized = browser.nibrunBeforeSend?.('identify', {
        ...nativePayload(browser.location.href),
        data,
      });
      if (sanitized) {
        identifications.push(sanitized);
      }
      return Promise.resolve();
    },
    track(payload: (defaults: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
      nativeTrack(payload(nativePayload(browser.location.href)));
      return Promise.resolve();
    },
  },
};
browser.parent = browser;
Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { doNotTrack: '1' } });
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookieWrite = value;
      cookie = value.split(';')[0]!;
    },
    referrer: 'https://github.com/readme?access_token=secret',
    createElement() {
      return { dataset: {} };
    },
    head: {
      appendChild(script: HTMLScriptElement) {
        scripts.push(script);
        if (script.src.endsWith('/script.js')) {
          nativeTrack(nativePayload(browser.location.href));
        }
        script.onload?.(new Event('load'));
      },
    },
  },
});

function nativePayload(url: string): Record<string, unknown> {
  return { website: 'website', url, title: 'Private app', referrer: document.referrer };
}

function nativeTrack(payload: Record<string, unknown>): void {
  const sanitized = browser.nibrunBeforeSend?.('event', payload);
  if (sanitized) {
    events.push(sanitized);
  }
}

afterAll(() => {
  if (originalUmamiHostname === undefined) {
    Reflect.deleteProperty(process.env, 'VITE_UMAMI_HOSTNAME');
  } else {
    process.env.VITE_UMAMI_HOSTNAME = originalUmamiHostname;
  }
  for (const [name, descriptor] of [
    ['window', originalWindow],
    ['document', originalDocument],
    ['navigator', originalNavigator],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

test('tracking excludes Do Not Track, frames and previews before creating an identifier', async () => {
  expect(await loadTracker()).toBe(false);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { doNotTrack: null },
  });
  browser.parent = {};
  expect(await loadTracker()).toBe(false);
  browser.parent = browser;
  browser.location.hostname = 'preview.nibrun.com';
  expect(await loadTracker()).toBe(false);
  expect(cookieWrite).toBe('');
  expect(scripts).toHaveLength(0);
  browser.location.hostname = 'nibrun.com';
});

test('native pageviews share identity and redact queries, titles and app IDs', async () => {
  expect(await loadTracker()).toBe(true);
  const id = analyticsIdentity();
  expect(cookieWrite).toContain('Domain=nibrun.com');
  expect(cookieWrite).toContain('Secure; SameSite=Lax');
  expect(scripts[0]?.dataset.distinctId).toBeUndefined();
  expect(scripts[0]?.dataset.autoTrack).toBeUndefined();
  expect(scripts[0]?.dataset.beforeSend).toBe('nibrunBeforeSend');
  expect(scripts[0]?.dataset.performance).toBe('true');
  expect(scripts[0]?.dataset.excludeSearch).toBe('true');
  expect(scripts[0]?.dataset.excludeHash).toBeUndefined();
  expect(scripts[0]?.src).toBe('https://analytics.example/script.js');
  nativeTrack(nativePayload('https://nibrun.com/?query=SECRET'));
  browser.location = {
    protocol: 'https:',
    hostname: 'app.nibrun.com',
    origin: 'https://app.nibrun.com',
    href: 'https://app.nibrun.com/deploy?env=SECRET',
  };
  expect(analyticsIdentity()).toBe(id);
  expect(await loadTracker()).toBe(true);
  nativeTrack(nativePayload(browser.location.href));
  nativeTrack(nativePayload('/apps/private-id/logs?path=SECRET'));
  nativeTrack(nativePayload('/apps/another-private-id/logs'));
  expect(scripts).toHaveLength(2);
  expect(events).toHaveLength(EXPECTED_PAGEVIEWS);
  expect(events[0]?.referrer).toBe('https://github.com');
  expect(events[0]?.id).toBe(id);
  expect(events[2]?.url).toBe('https://app.nibrun.com/dashboard/apps/:appId/logs');
  expect(JSON.stringify(events)).not.toContain('SECRET');
  expect(JSON.stringify(events)).not.toContain('Private app');
  expect(JSON.stringify(events)).not.toContain('private-id');
});

test('the recorder loads once alongside the tracker for the same website', async () => {
  expect(await loadTracker()).toBe(true);
  expect(scripts).toHaveLength(2);
  expect(scripts[1]?.src).toBe('https://analytics.example/recorder.js');
  expect(scripts[1]?.dataset.websiteId).toBe(scripts[0]?.dataset.websiteId);
  expect(scripts[1]?.async).toBe(true);
});

test('back and forward pageviews use the current URL and redact their referrer', () => {
  browser.location.href = 'https://app.nibrun.com/apps/private-id/files?path=SECRET';
  listeners.get('popstate')?.(new Event('popstate'));
  expect(events.at(-1)?.url).toBe('https://app.nibrun.com/dashboard/apps/:appId/files');
  expect(events.at(-1)?.referrer).toBe('https://app.nibrun.com/dashboard/apps/:appId/logs');
  const count = events.length;
  listeners.get('popstate')?.(new Event('popstate'));
  expect(events).toHaveLength(count);
});

test('direct hash visits and native hash navigation are distinct pageviews without duplicates', () => {
  const location = browser.location;
  const count = events.length;
  browser.location = {
    protocol: 'https:',
    hostname: 'nibrun.com',
    origin: 'https://nibrun.com',
    href: 'https://nibrun.com/?query=SECRET#pricing',
  };
  nativeTrack(nativePayload(browser.location.href));
  browser.location.href = 'https://nibrun.com/#features';
  listeners.get('hashchange')?.(new Event('hashchange'));
  nativeTrack(nativePayload(browser.location.href));
  browser.location.href = 'https://nibrun.com/#pricing';
  listeners.get('popstate')?.(new Event('popstate'));
  listeners.get('hashchange')?.(new Event('hashchange'));
  browser.location.href = 'https://nibrun.com/';
  listeners.get('hashchange')?.(new Event('hashchange'));
  expect(events.slice(count).map((event) => event.url)).toEqual([
    'https://nibrun.com/www/#pricing',
    'https://nibrun.com/www/#features',
    'https://nibrun.com/www/#pricing',
    'https://nibrun.com/www/',
  ]);
  expect(JSON.stringify(events.slice(count))).not.toContain('SECRET');
  browser.location = location;
});

test('performance payloads retain metrics and sanitized identity without suppressing pageviews', () => {
  const payload = {
    ...nativePayload('/apps/private-id/logs?path=SECRET#details'),
    referrer: '/apps/another-private-id/files?path=SECRET',
    lcp: 1200,
    ttfb: 150,
    fcp: 400,
    inp: 80,
    cls: 0.01,
    duration: 10000,
  };
  const sanitized = browser.nibrunBeforeSend?.('performance', payload);
  expect(sanitized).toEqual({
    ...payload,
    id: events[0]?.id,
    url: 'https://app.nibrun.com/dashboard/apps/:appId/logs#details',
    referrer: 'https://app.nibrun.com/dashboard/apps/:appId/files',
    title: 'nibrun dashboard',
  });
  expect(JSON.stringify(sanitized)).not.toContain('SECRET');
  expect(JSON.stringify(sanitized)).not.toContain('private-id');
  expect(JSON.stringify(sanitized)).not.toContain('Private app');
  expect(browser.nibrunBeforeSend?.('performance', payload)).toEqual(sanitized);
  const count = events.length;
  nativeTrack(payload);
  expect(events).toHaveLength(count + 1);
  expect(browser.nibrunBeforeSend?.('performance', payload)).toEqual(sanitized);
  nativeTrack(payload);
  expect(events).toHaveLength(count + 1);
});

test('performance payloads obey the tracking restrictions', () => {
  const payload = nativePayload(browser.location.href);
  const location = browser.location;
  const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')!;
  try {
    browser.parent = {};
    expect(browser.nibrunBeforeSend?.('performance', payload)).toBeUndefined();
    browser.parent = browser;
    browser.location = { ...location, hostname: 'preview.nibrun.com' };
    expect(browser.nibrunBeforeSend?.('performance', payload)).toBeUndefined();
    browser.location = { ...location, protocol: 'http:' };
    expect(browser.nibrunBeforeSend?.('performance', payload)).toBeUndefined();
    browser.location = location;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { doNotTrack: '1' },
    });
    expect(browser.nibrunBeforeSend?.('performance', payload)).toBeUndefined();
  } finally {
    browser.parent = browser;
    browser.location = location;
    Object.defineProperty(globalThis, 'navigator', navigator);
  }
});

test('all event payloads are filtered at send time and same-origin referrers are sanitized', () => {
  nativeTrack({
    ...nativePayload('/deploy?env=SECRET#configuration'),
    name: 'fixture_event',
    referrer: '/apps/private-id/files?path=SECRET',
  });
  expect(events.at(-1)?.referrer).toBe('https://app.nibrun.com/dashboard/apps/:appId/files');
  expect(events.at(-1)?.url).toBe('https://app.nibrun.com/dashboard/deploy#configuration');
  expect(JSON.stringify(events.at(-1))).not.toContain('SECRET');
  const count = events.length;
  expect(
    browser.nibrunBeforeSend?.('unsupported', nativePayload(browser.location.href)),
  ).toBeUndefined();
  browser.parent = {};
  nativeTrack({ ...nativePayload(browser.location.href), name: 'fixture_event' });
  expect(events).toHaveLength(count);
  browser.parent = browser;
});

test('acquisition survives the hostname change and events use sanitized context', async () => {
  recordEntry({ entry_source: 'preset', preset_slug: 'pocketbase' });
  expect(readEntry()).toEqual({ entry_source: 'preset', preset_slug: 'pocketbase' });
  const count = events.length;
  trackEvent({
    name: 'deploy_cta_clicked',
    data: { cta_placement: 'preset', preset_slug: 'pocketbase' },
  });
  await Promise.resolve();
  expect(events).toHaveLength(count + 1);
  expect(events.at(-1)?.data).toMatchObject({
    entry_source: 'preset',
    preset_slug: 'pocketbase',
    identity_state: 'unknown',
  });
  expect(JSON.stringify(events.at(-1))).not.toContain('SECRET');
  cookie = 'nibrun_analytics_entry=%7Bbad';
  expect(readEntry()).toEqual({ entry_source: 'direct', preset_slug: undefined });
  cookie = `nibrun_analytics_entry=${encodeURIComponent(JSON.stringify({ entry_source: 'preset', preset_slug: 'TOKEN=secret' }))}`;
  expect(readEntry().preset_slug).toBeUndefined();
});

test('authentication state changes keep the browser identifier intact', async () => {
  const authenticated = 'identified';
  expect(setAnalyticsIdentityState(authenticated)).toBe(true);
  expect(setAnalyticsIdentityState(authenticated)).toBe(false);
  trackEvent({ name: 'binary_selected', data: { size_bytes: 1 } });
  await Promise.resolve();
  expect(events.at(-1)?.id).toBe(events[0]?.id);
  expect(events.at(-1)?.data).toMatchObject({ identity_state: authenticated });
});

test('sign-in failure diagnostics reach the tracker with the original sign-in context', async () => {
  const count = events.length;
  trackEvent({
    name: 'sign_in_failed',
    data: {
      identity_state: 'anonymous',
      reason: 'keep-app',
      error_code: 'INVALID_ORIGIN',
      http_status: 403,
    },
  });
  await Promise.resolve();
  expect(events).toHaveLength(count + 1);
  expect(events.at(-1)?.name).toBe('sign_in_failed');
  expect(events.at(-1)?.data).toMatchObject({
    identity_state: 'anonymous',
    reason: 'keep-app',
    error_code: 'INVALID_ORIGIN',
    http_status: 403,
  });
});

test('account identification preserves the anonymous journey and excludes personal session data', async () => {
  const accountId = crypto.randomUUID();
  expect(setAnalyticsAccountId(accountId)).toBe(true);
  expect(setAnalyticsAccountId(accountId)).toBe(false);
  trackEvent({ name: 'binary_selected', data: { size_bytes: 1 } });
  await Promise.resolve();
  expect(identifications).toHaveLength(1);
  expect(identifications.at(-1)?.id).toBe(events[0]?.id);
  expect(identifications.at(-1)?.data).toEqual({ account_id: accountId });
  expect(events.at(-1)?.data).toMatchObject({ account_id: accountId });
  const sanitized = browser.nibrunBeforeSend?.('identify', {
    ...nativePayload('/apps/private-id?env=SECRET'),
    data: { email: 'private@example.com', name: 'Private name' },
  });
  expect(sanitized?.data).toEqual({ account_id: accountId });
  expect(JSON.stringify(sanitized)).not.toContain('SECRET');
  expect(JSON.stringify(sanitized)).not.toContain('private@example.com');
  expect(JSON.stringify(sanitized)).not.toContain('Private name');
});

test('account switching and sign-out update attribution without changing the browser identifier', async () => {
  const accountId = crypto.randomUUID();
  setAnalyticsAccountId(accountId);
  trackEvent({ name: 'binary_selected', data: { size_bytes: 1 } });
  await Promise.resolve();
  expect(events.at(-1)?.data).toMatchObject({ account_id: accountId });
  expect(identifications.at(-1)?.data).toEqual({ account_id: accountId });
  setAnalyticsAccountId(undefined);
  trackEvent({ name: 'binary_selected', data: { size_bytes: 1 } });
  await Promise.resolve();
  expect(events.at(-1)?.data).toHaveProperty('account_id', undefined);
  expect(identifications.at(-1)?.data).toEqual({ account_id: '' });
  expect(identifications.every((payload) => payload.id === events[0]?.id)).toBe(true);
});

test('queued identification cannot restore an account after sign-out and honors Do Not Track', async () => {
  const count = identifications.length;
  setAnalyticsAccountId(crypto.randomUUID());
  setAnalyticsAccountId(undefined);
  await Promise.resolve();
  expect(identifications).toHaveLength(count + 1);
  expect(identifications.at(-1)?.data).toEqual({ account_id: '' });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { doNotTrack: '1' },
  });
  setAnalyticsAccountId(crypto.randomUUID());
  await Promise.resolve();
  expect(identifications).toHaveLength(count + 1);
  expect(
    browser.nibrunBeforeSend?.('identify', nativePayload(browser.location.href)),
  ).toBeUndefined();
  setAnalyticsAccountId(undefined);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { doNotTrack: null },
  });
});
