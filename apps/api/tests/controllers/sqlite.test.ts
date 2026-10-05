import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';

const SELECT_URL = `${ORIGIN}/api/apps/app-1/sqlite/connections`;
const CONNECTION_URL = `${ORIGIN}/api/sqlite/connections/selection-1`;

test('all SQLite connection endpoints require the existing account session', async () => {
  const responses = await Promise.all([
    sendJson({ method: 'POST', url: SELECT_URL, body: { path: '/app.db' } }),
    send({ method: 'GET', url: `${CONNECTION_URL}/v2` }),
    sendJson({ method: 'POST', url: `${CONNECTION_URL}/v2/pipeline`, body: { requests: [] } }),
    send({ method: 'DELETE', url: CONNECTION_URL }),
  ]);
  for (const response of responses) {
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
});

test('SQLite selection rejects paths outside the volume at the HTTP boundary', async () => {
  for (const path of ['../app.db', '/data/../app.db']) {
    expect((await sendJson({ method: 'POST', url: SELECT_URL, body: { path } })).status).toBe(
      StatusMap['Bad Request'],
    );
  }
});
