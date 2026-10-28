import { expect, test } from 'bun:test';
import {
  InterruptedSourceError,
  RemoteSourceRepository,
} from '#repositories/remote-source.repository.ts';

const RESPONSE_MS = 50;
const IDLE_MS = 200;
const TOTAL_MS = 1_000;
const TIMEOUTS = { responseMs: RESPONSE_MS, idleMs: IDLE_MS, totalMs: TOTAL_MS };
const BINARY = 'a complete binary';

function mayDial() {
  return true;
}

function stall(): Promise<Response> {
  return new Promise(() => undefined);
}

function answer() {
  return new Response(BINARY);
}

function resolveLoopbacks() {
  return Promise.resolve(['127.0.0.1', '::1']);
}

test('a stalled address is aborted and the next resolved address serves the binary', async () => {
  const stalled = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: stall });
  const healthy = Bun.serve({ hostname: '::1', port: stalled.port, fetch: answer });
  const repo = new RemoteSourceRepository({
    mayDial,
    resolveAddresses: resolveLoopbacks,
    timeouts: TIMEOUTS,
  });
  try {
    const source = await repo.open({ url: `http://releases.example:${stalled.port}/binary` });
    expect(source.outcome).toBe('open');
    if (source.outcome === 'open') {
      expect(await new Response(source.body).text()).toBe(BINARY);
    }
    expect(stalled.pendingRequests).toBe(0);
  } finally {
    stalled.stop(true);
    healthy.stop(true);
  }
});

test('a hostname with only stalled addresses is unreachable before the transfer deadline', async () => {
  const disconnected = Promise.withResolvers<void>();
  function stalledRequest(request: Request) {
    request.signal.addEventListener('abort', () => disconnected.resolve(), { once: true });
    return stall();
  }
  const stalled = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: stalledRequest });
  const repo = new RemoteSourceRepository({ mayDial, timeouts: TIMEOUTS });
  try {
    expect(await repo.open({ url: stalled.url.toString() })).toEqual({ outcome: 'unreachable' });
    await disconnected.promise;
  } finally {
    stalled.stop(true);
  }
});

test('an unresponsive DNS lookup is bounded too', async () => {
  function resolveAddresses(): Promise<string[]> {
    return new Promise(() => undefined);
  }
  const repo = new RemoteSourceRepository({ resolveAddresses, timeouts: TIMEOUTS });
  expect(await repo.open({ url: 'https://releases.example/binary' })).toEqual({
    outcome: 'unreachable',
  });
});

test('every resolved address is validated before a fallback can be dialled', async () => {
  function resolveAddresses() {
    return Promise.resolve(['1.1.1.1', '127.0.0.1']);
  }
  const repo = new RemoteSourceRepository({
    resolveAddresses,
    timeouts: TIMEOUTS,
  });
  expect(await repo.open({ url: 'https://releases.example/binary' })).toEqual({
    outcome: 'private-address',
    host: 'releases.example',
  });
});

test('a successful response can keep downloading after its address timeout', async () => {
  function delayedBody() {
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode('a complete '));
          await Bun.sleep(RESPONSE_MS * 2);
          controller.enqueue(new TextEncoder().encode('binary'));
          controller.close();
        },
      }),
    );
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: delayedBody });
  const repo = new RemoteSourceRepository({ mayDial, timeouts: TIMEOUTS });
  try {
    const source = await repo.open({ url: server.url.toString() });
    expect(source.outcome).toBe('open');
    if (source.outcome === 'open') {
      expect(await new Response(source.body).text()).toBe(BINARY);
    }
  } finally {
    server.stop(true);
  }
});

test('a response body that stops sending fails and releases its connection', async () => {
  const disconnected = Promise.withResolvers<void>();
  function stalledBody() {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('incomplete'));
        },
        cancel() {
          disconnected.resolve();
        },
      }),
    );
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: stalledBody });
  const repo = new RemoteSourceRepository({ mayDial, timeouts: TIMEOUTS });
  try {
    const source = await repo.open({ url: server.url.toString() });
    expect(source.outcome).toBe('open');
    if (source.outcome === 'open') {
      await expect(new Response(source.body).text()).rejects.toBeInstanceOf(InterruptedSourceError);
      await disconnected.promise;
    }
  } finally {
    server.stop(true);
  }
});

test('the total deadline stops retries before the next address is dialled', async () => {
  let fallbackRequests = 0;
  function fallback() {
    fallbackRequests += 1;
    return answer();
  }
  const stalled = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: stall });
  const healthy = Bun.serve({ hostname: '::1', port: stalled.port, fetch: fallback });
  const repo = new RemoteSourceRepository({
    mayDial,
    resolveAddresses: resolveLoopbacks,
    timeouts: { ...TIMEOUTS, totalMs: RESPONSE_MS / 2 },
  });
  try {
    expect(await repo.open({ url: `http://releases.example:${stalled.port}/binary` })).toEqual({
      outcome: 'unreachable',
    });
    expect(fallbackRequests).toBe(0);
  } finally {
    stalled.stop(true);
    healthy.stop(true);
  }
});
