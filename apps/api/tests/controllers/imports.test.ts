import { describe, expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';

const APP_ID = '0199c0de-0000-7000-8000-000000000001';
const IMPORT_ID = '0199c0de-0000-7000-8000-000000000003';
const IMPORTS_URL = `${ORIGIN}/api/apps/${APP_ID}/imports`;

function create(body: unknown) {
  return sendJson({ method: 'POST', url: IMPORTS_URL, body });
}

function report(body: unknown) {
  return sendJson({ method: 'PATCH', url: `${IMPORTS_URL}/${IMPORT_ID}`, body });
}

// Nothing here presents a session: better-auth needs a database and this suite has none. What it
// does prove is that the routes exist — a 404 would mean the tree was never mounted — and that not
// one of them answers anything to a caller who has not proven who they are.
describe("an app's starting data is not somewhere strangers can write to", () => {
  test('being given somewhere to upload requires a session', async () => {
    const response = await create({ filename: 'pb_data.tar.gz', sizeBytes: 1 });

    expect(response.status).toBe(StatusMap.Unauthorized);
  });

  test('saying how an upload went requires a session', async () => {
    expect((await report({ upload: 'complete' })).status).toBe(StatusMap.Unauthorized);
  });

  test('reading one back requires a session', async () => {
    expect((await send({ url: `${IMPORTS_URL}/${IMPORT_ID}` })).status).toBe(
      StatusMap.Unauthorized,
    );
  });
});

// Body validation runs ahead of the session check, so these answer 400 rather than 401 — they say
// nothing about the app, only that the request was never what it claimed.
describe('a request that could not name an archive is not one', () => {
  test('asking for somewhere to upload without saying what or how large is not asking', async () => {
    expect((await create({})).status).toBe(StatusMap['Bad Request']);
  });

  test('a size that is not a size is not one', async () => {
    const response = await create({ filename: 'pb_data.tar.gz', sizeBytes: 'large' });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  // The only name anybody would recognise the archive by, so one carrying a path is refused at
  // the edge rather than sanitised into a different name.
  test('a filename that is a path is not a filename', async () => {
    const response = await create({ filename: '../../etc/passwd', sizeBytes: 1 });

    expect(response.status).toBe(StatusMap['Bad Request']);
  });

  test('an upload outcome that is neither is not one', async () => {
    expect((await report({ upload: 'maybe' })).status).toBe(StatusMap['Bad Request']);
  });
});
