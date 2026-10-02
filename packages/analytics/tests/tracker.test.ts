import { afterAll, expect, test } from 'bun:test';
import { analyticsIdentity } from '#identity.ts';
import { loadTracker, trackPage } from '#tracker.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let cookie = '';
let cookieWrite = '';
const scripts: HTMLScriptElement[] = [];
const events: Record<string, unknown>[] = [];
const EXPECTED_PAGEVIEWS = 4;
const browser = {
  location: { protocol: 'https:', hostname: 'nibrun.com', origin: 'https://nibrun.com' },
  parent: undefined as unknown,
  umami: {
    track(payload: (defaults: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
      events.push(
        payload({
          website: 'website',
          url: 'https://app.nibrun.com/deploy?env=SECRET',
          title: 'Private app',
        }),
      );
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
        script.onload?.(new Event('load'));
      },
    },
  },
});

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
  expect(await loadTracker(undefined)).toBe(false);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { doNotTrack: null },
  });
  browser.parent = {};
  expect(await loadTracker(undefined)).toBe(false);
  browser.parent = browser;
  browser.location.hostname = 'preview.nibrun.com';
  expect(await loadTracker(undefined)).toBe(false);
  expect(cookieWrite).toBe('');
  expect(scripts).toHaveLength(0);
  browser.location.hostname = 'nibrun.com';
});

test('both hosts reuse the identifier and collector without sending query values or app names', async () => {
  expect(await loadTracker('analytics.nibrun.com')).toBe(true);
  const id = analyticsIdentity();
  expect(cookieWrite).toContain('Domain=nibrun.com');
  expect(cookieWrite).toContain('Secure; SameSite=Lax');
  expect(scripts[0]?.dataset.distinctId).toBeUndefined();
  expect(scripts[0]?.dataset.autoTrack).toBe('false');
  expect(scripts[0]?.src).toBe('https://analytics.nibrun.com/script.js');
  trackPage('/');
  trackPage('/');
  browser.location = {
    protocol: 'https:',
    hostname: 'app.nibrun.com',
    origin: 'https://app.nibrun.com',
  };
  expect(analyticsIdentity()).toBe(id);
  expect(await loadTracker('analytics.nibrun.com')).toBe(true);
  trackPage('/deploy');
  trackPage('/apps/private-id/logs');
  trackPage('/apps/another-private-id/logs');
  expect(scripts).toHaveLength(1);
  expect(events).toHaveLength(EXPECTED_PAGEVIEWS);
  expect(events[0]?.referrer).toBe('https://github.com');
  expect(events[0]?.id).toBe(id);
  expect(events[1]?.referrer).toBe('https://nibrun.com/www/');
  expect(events[2]?.url).toBe('https://app.nibrun.com/dashboard/apps/:appId/logs');
  expect(JSON.stringify(events)).not.toContain('SECRET');
  expect(JSON.stringify(events)).not.toContain('Private app');
  expect(JSON.stringify(events)).not.toContain('private-id');
});
