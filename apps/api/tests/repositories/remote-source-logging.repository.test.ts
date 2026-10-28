import { expect, test } from 'bun:test';
import { RemoteSourceRepository } from '#repositories/remote-source.repository.ts';
import { recordingDownloadLogger } from '#tests/support/download-logs.ts';

const SECRET = 'private-download-token';

test('DNS failures retain resolver codes without logging their raw errors', async () => {
  const { logger, records } = recordingDownloadLogger();
  function resolveAddresses(): Promise<string[]> {
    return Promise.reject(
      Object.assign(new Error(SECRET), { code: 'EAI_AGAIN', syscall: 'getaddrinfo' }),
    );
  }
  const repo = new RemoteSourceRepository({ resolveAddresses, logger });
  expect(await repo.open({ url: `https://releases.example/${SECRET}?token=${SECRET}` })).toEqual({
    outcome: 'unreachable',
  });
  expect(records).toContainEqual(
    expect.objectContaining({
      phase: 'dns',
      event: 'failed',
      errorCode: 'EAI_AGAIN',
      syscall: 'getaddrinfo',
    }),
  );
  expect(JSON.stringify(records)).not.toContain(SECRET);
});

test('redirect logs contain origins and status but omit source and target tokens', async () => {
  const { logger, records } = recordingDownloadLogger();
  function redirect() {
    return new Response(null, {
      status: 302,
      headers: {
        location: `http://user:${SECRET}@files.example/${SECRET}?signature=${SECRET}#${SECRET}`,
      },
    });
  }
  function mayDial() {
    return true;
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: redirect });
  const repo = new RemoteSourceRepository({ mayDial, logger });
  try {
    const url = new URL(`/${SECRET}?token=${SECRET}`, server.url).toString();
    expect((await repo.open({ url })).outcome).toBe('insecure-redirect');
    expect(records).toContainEqual(
      expect.objectContaining({
        phase: 'redirect',
        event: 'refused',
        status: 302,
        hop: 0,
        toOrigin: 'http://files.example',
      }),
    );
    expect(JSON.stringify(records)).not.toContain(SECRET);
  } finally {
    server.stop(true);
  }
});

test('a downstream cancellation is logged as cancellation rather than a completed transfer', async () => {
  const { logger, records } = recordingDownloadLogger();
  function serve() {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first chunk'));
        },
      }),
    );
  }
  function mayDial() {
    return true;
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: serve });
  const repo = new RemoteSourceRepository({ mayDial, logger });
  try {
    const source = await repo.open({ url: server.url.toString() });
    expect(source.outcome).toBe('open');
    if (source.outcome === 'open') {
      const reader = source.body.getReader();
      await reader.read();
      await reader.cancel(SECRET);
    }
    expect(records).toContainEqual(expect.objectContaining({ phase: 'body', event: 'cancelled' }));
    expect(
      records.filter((record) => record.phase === 'body' && record.event === 'completed'),
    ).toHaveLength(0);
    expect(JSON.stringify(records)).not.toContain(SECRET);
  } finally {
    server.stop(true);
  }
});
