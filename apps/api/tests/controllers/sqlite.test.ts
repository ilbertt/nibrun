import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';

const CREATE_URL = `${ORIGIN}/api/apps/app-1/sqlite/connections`;
const CONNECTION_URL = `${ORIGIN}/api/sqlite/connections/connection-1`;

test('all SQLite connection endpoints require the existing account session', async () => {
  const responses = await Promise.all([
    sendJson({ method: 'POST', url: CREATE_URL, body: { sqlite_file_path: '/app.db' } }),
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
