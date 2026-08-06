import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { Effect, Layer } from 'effect';
import { TenantLogQueue } from '#services/tenant-log-queue.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';
import { LOG_SOURCE } from '#tests/support/fixtures.ts';
import { gapFrame, guestLogFrame } from '#tests/support/guest-frames.ts';
import { drainedEvents } from '#tests/support/logs.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const EXPECTED_EVENT_COUNT = 3;
const DROPPED_BYTES = 17n;
const MAX_GUEST_CONNECTIONS = 4;
const SETTLE_MS = 50;

// The receiver publishes to the queue this drains: naming one layer twice still builds it once.
const run = provided(
  Layer.mergeAll(TenantLogReceiver.Default, TenantLogQueue.Default).pipe(
    Layer.provideMerge(platform),
  ),
);

async function connect(socketPath: string): Promise<Socket> {
  const socket = createConnection(socketPath);
  const connected = Promise.withResolvers<void>();
  socket.once('connect', connected.resolve);
  socket.once('error', connected.reject);
  await connected.promise;
  return socket;
}

const attached = Effect.gen(function* () {
  const receiver = yield* TenantLogReceiver;
  const socketPath = join(yield* temporaryDirectory, 'logs.sock');
  yield* receiver.attach({ source: LOG_SOURCE, socketPath });
  return socketPath;
});

test('a guest connection becomes identified, ordered API events', async () => {
  const events = await run(
    Effect.gen(function* () {
      const socketPath = yield* attached;
      const queue = yield* TenantLogQueue;

      yield* Effect.promise(async () => {
        const socket = await connect(socketPath);
        const euro = Buffer.from('€');
        socket.write(guestLogFrame({ kind: 'stdout', payload: euro.subarray(0, 2) }));
        socket.write(guestLogFrame({ kind: 'stdout', payload: euro.subarray(2) }));
        socket.write(guestLogFrame({ kind: 'stderr', payload: Buffer.from('failed\n') }));
        socket.write(gapFrame(DROPPED_BYTES));
        await Bun.sleep(SETTLE_MS);
        socket.destroy();
        await Bun.sleep(SETTLE_MS);
      });

      return yield* drainedEvents(queue);
    }),
  );

  expect(events.length).toBe(EXPECTED_EVENT_COUNT);
  expect(events.map(({ kind }) => kind)).toEqual(['data', 'data', 'gap']);
  expect(events.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
  expect(events[0]).toMatchObject({
    kind: 'data',
    stream: 'stdout',
    text: '€',
    appId: LOG_SOURCE.appId,
  });
  expect(events[1]).toMatchObject({ kind: 'data', stream: 'stderr', text: 'failed\n' });
  expect(events[2]).toMatchObject({ kind: 'gap', droppedBytes: Number(DROPPED_BYTES) });
  expect(events.every(({ sourceId }) => sourceId === events[0]?.sourceId)).toBe(true);
});

// The peer on this socket is a kernel the tenant controls, and every socket the host accepts
// costs it a frame decoder and two streaming text decoders.
test('a guest cannot open unbounded connections to its own log socket', async () => {
  const closed = await run(
    Effect.flatMap(attached, (socketPath) =>
      Effect.promise(async () => {
        const sockets: Socket[] = [];
        const wasClosed: boolean[] = [];
        for (let index = 0; index <= MAX_GUEST_CONNECTIONS; index += 1) {
          wasClosed[index] = false;
          const socket = await connect(socketPath);
          socket.on('close', () => {
            wasClosed[index] = true;
          });
          sockets.push(socket);
        }
        await Bun.sleep(SETTLE_MS);
        const observed = [...wasClosed];
        for (const socket of sockets) {
          socket.destroy();
        }
        return observed;
      }),
    ),
  );

  expect(closed.slice(0, MAX_GUEST_CONNECTIONS).some((value) => value)).toBe(false);
  expect(closed[MAX_GUEST_CONNECTIONS]).toBe(true);
});
