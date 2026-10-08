import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';

const CREATE_URL = `${ORIGIN}/api/apps/app-1/sqlite/connections`;
const CONNECTION_URL = `${ORIGIN}/api/sqlite/connections/connection-1`;

test('all SQLite connection endpoints require the existing account session', async () => {
  const responses = await Promise.all([
    sendJson({ method: 'POST', url: CREATE_URL, body: { sqlite_file_path: '/app.db' } }),
    send({ method: 'GET', url: CONNECTION_URL }),
    send({ method: 'GET', url: `${CONNECTION_URL}/v2` }),
    sendJson({ method: 'POST', url: `${CONNECTION_URL}/v2/pipeline`, body: { requests: [] } }),
    send({ method: 'DELETE', url: `${CREATE_URL}/connection-1` }),
    send({ method: 'GET', url: CREATE_URL }),
  ]);
  for (const response of responses) {
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
});

test('SQLite connection rejects paths outside the volume at the HTTP boundary', async () => {
  for (const path of ['../app.db', '/data/../app.db']) {
    expect(
      (await sendJson({ method: 'POST', url: CREATE_URL, body: { sqlite_file_path: path } }))
        .status,
    ).toBe(StatusMap['Bad Request']);
  }
});

test('SQLite discovery supports browser preflights and exposes authentication failures through CORS', async () => {
  const url = `${CONNECTION_URL}/v2`;
  const origin = 'https://client.test';
  const preflight = await send({
    method: 'OPTIONS',
    url,
    headers: {
      origin,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  });
  expect(preflight.status).toBe(StatusMap['No Content']);
  expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
  expect(preflight.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type');
  expect(preflight.headers.has('access-control-allow-credentials')).toBe(false);
  const denied = await send({ url, headers: { origin } });
  expect(denied.status).toBe(StatusMap.Unauthorized);
  expect(denied.headers.get('access-control-allow-origin')).toBe(origin);
  for (const unrelatedUrl of [CREATE_URL, `${ORIGIN}/api/health`]) {
    const unrelated = await send({ url: unrelatedUrl, headers: { origin } });
    expect(unrelated.headers.has('access-control-allow-origin')).toBe(false);
    const unrelatedPreflight = await send({
      method: 'OPTIONS',
      url: unrelatedUrl,
      headers: { origin, 'access-control-request-method': 'GET' },
    });
    expect(unrelatedPreflight.headers.has('access-control-allow-origin')).toBe(false);
  }
});
