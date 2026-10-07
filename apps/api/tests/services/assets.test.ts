import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { AssetsService } from '#services/assets.service.ts';

const HTML = '<!doctype html><title>Dashboard</title>';
const assets = new Map([['/index.html', new Blob([HTML], { type: 'text/html' })]]);
const service = new AssetsService({
  list() {
    return assets;
  },
});

test('dashboard navigation still receives the HTML fallback', async () => {
  const response = service.fallback(
    new Request('http://localhost/apps/example', {
      headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    }),
  );
  expect(response?.status).toBe(StatusMap.OK);
  expect(await response?.text()).toBe(HTML);
});

test('unsupported database probes do not receive dashboard HTML', () => {
  for (const accept of [undefined, '*/*', 'application/json']) {
    const headers = new Headers({ authorization: 'Bearer existing-session' });
    if (accept) {
      headers.set('accept', accept);
    }
    expect(service.fallback(new Request('http://localhost/v1/jobs', { headers }))).toBeNull();
  }
});

test('non-navigation requests and missing assets do not receive dashboard HTML', () => {
  for (const input of [
    { method: 'POST', path: '/apps/example' },
    { method: 'OPTIONS', path: '/apps/example' },
    { method: 'GET', path: '/missing.js' },
  ]) {
    expect(
      service.fallback(
        new Request(`http://localhost${input.path}`, {
          method: input.method,
          headers: { accept: 'text/html' },
        }),
      ),
    ).toBeNull();
  }
});

test('HEAD dashboard navigation remains eligible for the HTML fallback', () => {
  expect(
    service.fallback(
      new Request('http://localhost/apps/example', {
        method: 'HEAD',
        headers: { accept: 'text/html' },
      }),
    )?.status,
  ).toBe(StatusMap.OK);
});
