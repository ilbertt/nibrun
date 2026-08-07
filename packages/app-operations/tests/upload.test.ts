import { expect, test } from 'bun:test';
import { streamedUpload, type UploadProgress } from '#upload.ts';

const BODY_BYTES = 131_072;
const REFUSED = 403;

function bytes(): Blob {
  return new Blob([new Uint8Array(BODY_BYTES)]);
}

/**
 * The store checks the length against the one it signed, and a body sent chunked carries none for
 * it to check — so this is the assertion the whole upload rests on.
 */
test('the length is declared rather than left to chunking', async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const received = await request.arrayBuffer();
      return Response.json({
        method: request.method,
        contentLength: request.headers.get('content-length'),
        transferEncoding: request.headers.get('transfer-encoding'),
        received: received.byteLength,
      });
    },
  });

  try {
    const response = await streamedUpload({
      url: `http://localhost:${server.port}/artifact`,
      body: bytes(),
      onProgress: () => {},
    });

    expect(await response.json()).toEqual({
      method: 'PUT',
      contentLength: String(BODY_BYTES),
      transferEncoding: null,
      received: BODY_BYTES,
    });
  } finally {
    server.stop(true);
  }
});

test('progress is counted on the way past, and adds up to the whole body', async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      await request.arrayBuffer();
      return new Response('');
    },
  });
  const seen: UploadProgress[] = [];

  try {
    await streamedUpload({
      url: `http://localhost:${server.port}/artifact`,
      body: bytes(),
      onProgress: (progress) => seen.push(progress),
    });
  } finally {
    server.stop(true);
  }

  expect(seen.length).toBeGreaterThan(0);
  expect(seen.at(-1)).toEqual({ sentBytes: BODY_BYTES, totalBytes: BODY_BYTES });
  expect(seen.every((progress) => progress.totalBytes === BODY_BYTES)).toBe(true);
});

// What the store said is read for the sentence in it, so a refusal has to come back rather than
// be thrown as a status.
test('a refusal comes back as the response it was', async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response('<Error><Message>nope</Message></Error>', { status: REFUSED }),
  });

  try {
    const response = await streamedUpload({
      url: `http://localhost:${server.port}/artifact`,
      body: bytes(),
      onProgress: () => {},
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(REFUSED);
    expect(await response.text()).toContain('nope');
  } finally {
    server.stop(true);
  }
});
