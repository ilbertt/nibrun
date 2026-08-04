import { beforeAll, describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';

const BETTER_AUTH_SECRET_LENGTH = 32;

// The api reads its configuration when the service graph is constructed, so the
// environment has to exist before the app module is imported.
const REQUIRED_ENV = {
  DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
  BETTER_AUTH_SECRET: 'x'.repeat(BETTER_AUTH_SECRET_LENGTH),
  GITHUB_CLIENT_ID: 'test',
  GITHUB_CLIENT_SECRET: 'test',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  VICTORIALOGS_ENDPOINT: 'http://127.0.0.1:1',
  ARTIFACTS_BUCKET: 'test',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  S3_REGION: 'test',
  APP_HOST_DOMAIN: 'apps.test',
};

// A single-label host breaks path matching in Elysia 1.4.29, so every route resolves to 404.
const ORIGIN = 'http://localhost';
const APP_ID = '0199c0de-0000-7000-8000-000000000001';
const ARTIFACT_ID = '0199c0de-0000-7000-8000-000000000002';
const artifactsPath = `${ORIGIN}/api/apps/${APP_ID}/artifacts`;

let app: { handle: (request: Request) => Promise<Response> };

beforeAll(async () => {
  Object.assign(process.env, REQUIRED_ENV);
  const { createApp } = await import('#app.ts');
  app = createApp();
});

function upload(body: FormData) {
  return app.handle(new Request(artifactsPath, { method: 'POST', body }));
}

// Nothing here presents a session: better-auth needs a database and this suite has none. What
// it does prove is that the routes exist — a 404 would mean the tree was never mounted — and
// that not one of them answers anything to a caller who has not proven who they are.
describe('an app is not somewhere strangers can read from or write to', () => {
  test('listing artifacts requires a session', async () => {
    expect((await app.handle(new Request(artifactsPath))).status).toBe(StatusMap.Unauthorized);
  });

  test('fetching one artifact requires a session', async () => {
    const response = await app.handle(new Request(`${artifactsPath}/${ARTIFACT_ID}`));

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
