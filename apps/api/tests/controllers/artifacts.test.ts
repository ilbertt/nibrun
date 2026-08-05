import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';

const APP_ID = '0199c0de-0000-7000-8000-000000000001';
const ARTIFACT_ID = '0199c0de-0000-7000-8000-000000000002';
const ARTIFACTS_URL = `${ORIGIN}/api/apps/${APP_ID}/artifacts`;

function upload(body: FormData) {
  return send({ method: 'POST', url: ARTIFACTS_URL, body });
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

  test('uploading an artifact requires a session', async () => {
    const form = new FormData();
    form.set('binary', new Blob([new TextEncoder().encode('#!/bin/true')]), 'server');

    expect((await upload(form)).status).toBe(StatusMap.Unauthorized);
  });

  // Body validation runs ahead of the session check, so this one answers 400 rather than 401 —
  // it says nothing about the app, only that the request was never an upload.
  test('a request carrying no binary is not an upload', async () => {
    expect((await upload(new FormData())).status).toBe(StatusMap['Bad Request']);
  });
});
