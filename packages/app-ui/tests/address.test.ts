import { expect, test } from 'bun:test';
import { appUrl } from '#address.ts';

const platform = { hostname: 'my-app.nibrun.app', kind: 'platform', state: 'active' };
const custom = { hostname: 'app.example.com', kind: 'custom', state: 'active' };

test('an active custom domain is the public URL even when the platform hostname comes first', () => {
  expect(appUrl([platform, custom])).toBe('https://app.example.com');
});

test('a custom domain still produces a URL without a platform hostname', () => {
  expect(appUrl([custom])).toBe('https://app.example.com');
});

test.each(['pending', 'failed'])('a %s custom domain falls back to the platform URL', (state) => {
  expect(appUrl([{ ...custom, state }, platform])).toBe('https://my-app.nibrun.app');
});

test('an app without any hostname is an invalid state', () => {
  expect(() => appUrl([])).toThrow('The app was created without a hostname.');
});
