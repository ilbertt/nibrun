import { afterAll, expect, test } from 'bun:test';
import { analyticsIdentity } from '#identity.ts';
import { loadTracker } from '#tracker.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let cookie = '';
let cookieWrite = '';
const scripts: HTMLScriptElement[] = [];
const events: Record<string, unknown>[] = [];
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
        nativeTrack(nativePayload(browser.location.href));
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
  expect(scripts[0]?.dataset.excludeSearch).toBe('true');
  expect(scripts[0]?.dataset.excludeHash).toBe('true');
  expect(scripts[0]?.src).toBe('https://umami.nibrun.com/script.js');
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
  expect(scripts).toHaveLength(1);
  expect(events).toHaveLength(EXPECTED_PAGEVIEWS);
  expect(events[0]?.referrer).toBe('https://github.com');
  expect(events[0]?.id).toBe(id);
  expect(events[2]?.url).toBe('https://app.nibrun.com/dashboard/apps/:appId/logs');
  expect(JSON.stringify(events)).not.toContain('SECRET');
  expect(JSON.stringify(events)).not.toContain('Private app');
  expect(JSON.stringify(events)).not.toContain('private-id');
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

test('all event payloads are filtered at send time and same-origin referrers are sanitized', () => {
  nativeTrack({
    ...nativePayload('/deploy?env=SECRET'),
    name: 'fixture_event',
    referrer: '/apps/private-id/files?path=SECRET',
  });
  expect(events.at(-1)?.referrer).toBe('https://app.nibrun.com/dashboard/apps/:appId/files');
  expect(events.at(-1)?.url).toBe('https://app.nibrun.com/dashboard/deploy');
  expect(JSON.stringify(events.at(-1))).not.toContain('SECRET');
  const count = events.length;
  expect(
    browser.nibrunBeforeSend?.('identify', nativePayload(browser.location.href)),
  ).toBeUndefined();
  browser.parent = {};
  nativeTrack({ ...nativePayload(browser.location.href), name: 'fixture_event' });
  expect(events).toHaveLength(count);
  browser.parent = browser;
});
