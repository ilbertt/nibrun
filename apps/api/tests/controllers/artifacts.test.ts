import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';

const APP_ID = '0199c0de-0000-7000-8000-000000000001';
const ARTIFACT_ID = '0199c0de-0000-7000-8000-000000000002';
const ARTIFACTS_URL = `${ORIGIN}/api/apps/${APP_ID}/artifacts`;

function create(body: unknown) {
  return sendJson({ method: 'POST', url: ARTIFACTS_URL, body });
}

function report(body: unknown) {
  return sendJson({ method: 'PATCH', url: `${ARTIFACTS_URL}/${ARTIFACT_ID}`, body });
}

// Nothing here presents a session: better-auth needs a database and this suite has none. What
// it does prove is that the routes exist — a 404 would mean the tree was never mounted — and
// that not one of them answers anything to a caller who has not proven who they are.
describe('an app is not somewhere strangers can read from or write to', () => {
  test('listing artifacts requires a session', async () => {
    expect((await send({ url: ARTIFACTS_URL })).status).toBe(StatusMap.Unauthorized);
  });

  test('fetching one artifact requires a session', async () => {
    const response = await send({ url: `${ARTIFACTS_URL}/${ARTIFACT_ID}` });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('being given somewhere to upload requires a session', async () => {
    const response = await create({ filename: 'server', sizeBytes: 1 });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('saying how an upload went requires a session', async () => {
    expect((await report({ upload: 'complete' })).status).toBe(StatusMap.Unauthorized);
  });
});

// Body validation runs ahead of the session check, so these answer 400 rather than 401 — they
// say nothing about the app, only that the request was never what it claimed.
describe('a request that could not name a binary is not one', () => {
  test('asking for somewhere to upload without saying what or how large is not asking', async () => {
    expect((await create({})).status).toBe(StatusMap['Bad Request']);
  });

  test('a size that is not a size is not one', async () => {
    const response = await create({ filename: 'server', sizeBytes: 'large' });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // The name is written into an export archive, so one carrying a path is refused at the edge
  // rather than sanitised into a different name.
  test('a filename that is a path is not a filename', async () => {
    const response = await create({ filename: '../../etc/passwd', sizeBytes: 1 });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('an upload went one of two ways, and nothing else is an answer', async () => {
    expect((await report({ upload: 'probably' })).status).toBe(StatusMap['Bad Request']);
    expect((await report({})).status).toBe(StatusMap['Bad Request']);
  });
});
