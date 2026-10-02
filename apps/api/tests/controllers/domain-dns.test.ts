import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, sendJson } from '#tests/controllers/support/api.ts';

const URL = `${ORIGIN}/api/apps/app-1/hostnames/dns`;

test('DNS checks require a signed-in owner', async () => {
  const response = await sendJson({ url: `${URL}?hostname=app.example.dev` });
  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test('DNS checks reject arbitrary URLs and require a hostname', async () => {
  for (const query of [
    '',
    '?hostname=https://example.com',
    '?hostname=app.example.dev&target=other.example.com',
  ]) {
    expect((await sendJson({ url: `${URL}${query}` })).status).toBe(StatusMap['Bad Request']);
  }
});
