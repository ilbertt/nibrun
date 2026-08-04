import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppId, DeploymentId, InstanceId, TenantLogEvent } from '@repo/protocol';
import { Chunk, Deferred, Effect, Layer, Stream } from 'effect';
import { encodeGuestLogFrameForTest } from '#logs/guest-protocol.ts';
import { TenantLogQueue } from '#logs/queue.ts';
import { TenantLogReceiver } from '#logs/receiver.ts';
import { platform } from '#testing.ts';

const EXPECTED_EVENT_COUNT = 3;
const GAP_PAYLOAD_BYTES = 8;
const DROPPED_BYTES = 17n;
const MAX_GUEST_CONNECTIONS = 4;
const SETTLE_MS = 50;

const SOURCE = {
  appId: 'app-1' as AppId,
  deploymentId: 'deployment-1' as DeploymentId,
  instanceId: 'instance-1' as InstanceId,
};

const layer = TenantLogReceiver.Default.pipe(
  Layer.provideMerge(Layer.merge(TenantLogQueue.Default, platform)),
);

const decoder = new TextDecoder();

const connect = async (socketPath: string): Promise<Socket> => {
  const socket = createConnection(socketPath);
  const connected = Promise.withResolvers<void>();
  socket.once('connect', connected.resolve);
  socket.once('error', connected.reject);
  await connected.promise;
  return socket;
};

const inTemporaryDirectory = async (run: (socketPath: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'nibrun-logs-'));
  try {
    await run(join(directory, 'logs.sock'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

/** Everything the queue holds once the guest has finished writing. */
const published = (queue: TenantLogQueue) =>
  Effect.gen(function* () {
    const ending = yield* Deferred.make<void>();
    yield* Deferred.succeed(ending, undefined);
    const chunks = Chunk.toReadonlyArray(yield* Stream.runCollect(queue.body(ending)));
    return chunks.map((chunk) => JSON.parse(decoder.decode(chunk)) as TenantLogEvent);
  });

test('a guest connection becomes identified, ordered API events', async () => {
  await inTemporaryDirectory(async (socketPath) => {
    const events = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const receiver = yield* TenantLogReceiver;
          const queue = yield* TenantLogQueue;
          yield* receiver.attach({ source: SOURCE, socketPath });

          yield* Effect.promise(async () => {
            const socket = await connect(socketPath);
            const euro = Buffer.from('€');
            socket.write(
              encodeGuestLogFrameForTest({ kind: 'stdout', payload: euro.subarray(0, 2) }),
            );
            socket.write(encodeGuestLogFrameForTest({ kind: 'stdout', payload: euro.subarray(2) }));
            socket.write(
              encodeGuestLogFrameForTest({ kind: 'stderr', payload: Buffer.from('failed\n') }),
            );
            const gap = Buffer.alloc(GAP_PAYLOAD_BYTES);
            gap.writeBigUInt64BE(DROPPED_BYTES);
            socket.write(encodeGuestLogFrameForTest({ kind: 'gap', payload: gap }));
            await Bun.sleep(SETTLE_MS);
            socket.destroy();
            await Bun.sleep(SETTLE_MS);
          });

          return yield* published(queue);
        }),
      ).pipe(Effect.provide(layer)),
    );

    expect(events.length).toBe(EXPECTED_EVENT_COUNT);
    expect(events.map(({ kind }) => kind)).toEqual(['data', 'data', 'gap']);
    expect(events.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
    expect(events[0]).toMatchObject({
      kind: 'data',
      stream: 'stdout',
      text: '€',
      instanceId: SOURCE.instanceId,
    });
    expect(events[1]).toMatchObject({ kind: 'data', stream: 'stderr', text: 'failed\n' });
    expect(events[2]).toMatchObject({ kind: 'gap', droppedBytes: 17 });
    expect(events.every(({ sourceId }) => sourceId === events[0]?.sourceId)).toBe(true);
  });
});

// The peer on this socket is a kernel the tenant controls, and every socket the host accepts
// costs it a frame decoder and two streaming text decoders.
test('a guest cannot open unbounded connections to its own log socket', async () => {
  await inTemporaryDirectory(async (socketPath) => {
    const closed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const receiver = yield* TenantLogReceiver;
          yield* receiver.attach({ source: SOURCE, socketPath });

          return yield* Effect.promise(async () => {
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
          });
        }),
      ).pipe(Effect.provide(layer)),
    );

    expect(closed.slice(0, MAX_GUEST_CONNECTIONS).some((value) => value)).toBe(false);
    expect(closed[MAX_GUEST_CONNECTIONS]).toBe(true);
  });
});
