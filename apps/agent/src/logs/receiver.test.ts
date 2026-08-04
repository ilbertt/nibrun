import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppId, DeploymentId, InstanceId, TenantLogEvent } from '@repo/protocol';
import { encodeGuestLogFrameForTest } from '#logs/guest-protocol.ts';
import { TenantLogReceiver } from '#logs/receiver.ts';

const EXPECTED_EVENT_COUNT = 3;
const GAP_PAYLOAD_BYTES = 8;
const DROPPED_BYTES = 17n;
const MAX_GUEST_CONNECTIONS = 4;

const SOURCE = {
  appId: 'app-1' as AppId,
  deploymentId: 'deployment-1' as DeploymentId,
  instanceId: 'instance-1' as InstanceId,
};

async function connect(socketPath: string): Promise<Socket> {
  const socket = createConnection(socketPath);
  const connected = Promise.withResolvers<void>();
  socket.once('connect', connected.resolve);
  socket.once('error', connected.reject);
  await connected.promise;
  return socket;
}

test('a guest connection becomes identified, ordered API events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nibrun-logs-'));
  const socketPath = join(directory, 'logs.sock');
  const events: TenantLogEvent[] = [];
  let received!: () => void;
  const complete = new Promise<void>((resolve) => {
    received = resolve;
  });
  const receiver = new TenantLogReceiver({
    publish: (event) => {
      events.push(event);
      if (events.length === EXPECTED_EVENT_COUNT) {
        received();
      }
    },
  });
  const instanceId = 'instance-1' as InstanceId;

  try {
    await receiver.attach({ source: SOURCE, socketPath });
    const socket = await connect(socketPath);

    const euro = Buffer.from('€');
    socket.write(encodeGuestLogFrameForTest({ kind: 'stdout', payload: euro.subarray(0, 2) }));
    socket.write(encodeGuestLogFrameForTest({ kind: 'stdout', payload: euro.subarray(2) }));
    socket.write(encodeGuestLogFrameForTest({ kind: 'stderr', payload: Buffer.from('failed\n') }));
    const gap = Buffer.alloc(GAP_PAYLOAD_BYTES);
    gap.writeBigUInt64BE(DROPPED_BYTES);
    socket.write(encodeGuestLogFrameForTest({ kind: 'gap', payload: gap }));

    await complete;
    socket.destroy();

    expect(events.map(({ kind }) => kind)).toEqual(['data', 'data', 'gap']);
    expect(events.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
    expect(events[0]).toMatchObject({ kind: 'data', stream: 'stdout', text: '€', instanceId });
    expect(events[1]).toMatchObject({ kind: 'data', stream: 'stderr', text: 'failed\n' });
    expect(events[2]).toMatchObject({ kind: 'gap', droppedBytes: 17 });
    expect(events.every(({ sourceId }) => sourceId === events[0]?.sourceId)).toBe(true);
  } finally {
    await receiver.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// The peer on this socket is a kernel the tenant controls, and every socket the host accepts
// costs it a frame decoder and two streaming text decoders.
test('a guest cannot open unbounded connections to its own log socket', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nibrun-logs-'));
  const socketPath = join(directory, 'logs.sock');
  const receiver = new TenantLogReceiver({ publish: () => {} });
  const sockets: Socket[] = [];
  const closed: boolean[] = [];
  const refused = Promise.withResolvers<void>();

  try {
    await receiver.attach({ source: SOURCE, socketPath });

    for (let index = 0; index <= MAX_GUEST_CONNECTIONS; index += 1) {
      closed[index] = false;
      const socket = await connect(socketPath);
      socket.on('close', () => {
        closed[index] = true;
        if (index === MAX_GUEST_CONNECTIONS) {
          refused.resolve();
        }
      });
      sockets.push(socket);
    }

    await refused.promise;
    expect(closed.slice(0, MAX_GUEST_CONNECTIONS).some((value) => value)).toBe(false);
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await receiver.close();
    await rm(directory, { recursive: true, force: true });
  }
});
