import { Buffer } from 'node:buffer';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import type {
  AppId,
  DeploymentId,
  InstanceId,
  TenantLogEvent,
  TenantLogStream,
} from '@repo/protocol';
import { nowTimestamp } from '#lib/clock.ts';
import { logger } from '#lib/logger.ts';
import { GuestLogFrameDecoder } from '#logs/guest-protocol.ts';

export const TENANT_LOG_VSOCK_PORT = 51000;
export const TENANT_LOG_VSOCK_FILENAME = 'logs.vsock';

const PRIVATE_SOCKET_MODE = 0o600;

export type TenantLogSource = {
  appId: AppId;
  deploymentId: DeploymentId;
  instanceId: InstanceId;
};

type Attachment = {
  source: TenantLogSource;
  sourceId: string;
  socketPath: string;
  server: Server;
  sockets: Set<Socket>;
  nextSequence: number;
};

export const tenantLogSocketPath = ({ workingDir }: { workingDir: string }) =>
  join(workingDir, `${TENANT_LOG_VSOCK_FILENAME}_${TENANT_LOG_VSOCK_PORT}`);

export class TenantLogReceiver {
  readonly #publish: (event: TenantLogEvent) => void;
  readonly #attachments = new Map<InstanceId, Attachment>();

  constructor({ publish }: { publish: (event: TenantLogEvent) => void }) {
    this.#publish = publish;
  }

  async attach({
    source,
    socketPath,
  }: {
    source: TenantLogSource;
    socketPath: string;
  }): Promise<void> {
    const existing = this.#attachments.get(source.instanceId);
    if (existing?.socketPath === socketPath) {
      existing.source = source;
      return;
    }
    if (existing) {
      await this.detach({ instanceId: source.instanceId });
    }
    for (const attached of this.#attachments.values()) {
      if (attached.socketPath === socketPath) {
        await this.detach({ instanceId: attached.source.instanceId });
        break;
      }
    }

    await mkdir(dirname(socketPath), { recursive: true });
    await rm(socketPath, { force: true });
    const sockets = new Set<Socket>();
    let attachment: Attachment;
    const server = createServer((socket) => this.#accept({ attachment, socket }));
    attachment = {
      source,
      sourceId: crypto.randomUUID(),
      socketPath,
      server,
      sockets,
      nextSequence: 0,
    };
    await listen({ server, socketPath });
    try {
      await chmod(socketPath, PRIVATE_SOCKET_MODE);
    } catch (error) {
      server.close();
      await rm(socketPath, { force: true });
      throw error;
    }
    this.#attachments.set(source.instanceId, attachment);
  }

  async detach({ instanceId }: { instanceId: InstanceId }): Promise<void> {
    const attachment = this.#attachments.get(instanceId);
    if (!attachment) {
      return;
    }
    this.#attachments.delete(instanceId);
    for (const socket of attachment.sockets) {
      socket.destroy();
    }
    await close(attachment.server);
    await rm(attachment.socketPath, { force: true });
  }

  async close(): Promise<void> {
    for (const instanceId of [...this.#attachments.keys()]) {
      await this.detach({ instanceId });
    }
  }

  #accept({ attachment, socket }: { attachment: Attachment; socket: Socket }): void {
    attachment.sockets.add(socket);
    const frames = new GuestLogFrameDecoder();
    const text = {
      stdout: new TextDecoder(),
      stderr: new TextDecoder(),
    } satisfies Record<TenantLogStream, TextDecoder>;

    socket.on('data', (chunk) => {
      try {
        for (const frame of frames.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)) {
          if (frame.kind === 'gap') {
            this.#emit({ attachment, event: { kind: 'gap', droppedBytes: frame.droppedBytes } });
            continue;
          }
          const decoded = text[frame.stream].decode(frame.bytes, { stream: true });
          if (decoded.length > 0) {
            this.#emit({
              attachment,
              event: { kind: 'data', stream: frame.stream, text: decoded },
            });
          }
        }
      } catch {
        socket.destroy();
      }
    });
    socket.on('close', () => {
      attachment.sockets.delete(socket);
      for (const stream of ['stdout', 'stderr'] as const) {
        const remainder = text[stream].decode();
        if (remainder.length > 0) {
          this.#emit({
            attachment,
            event: { kind: 'data', stream, text: remainder },
          });
        }
      }
    });
    socket.on('error', () => {});
  }

  #emit({
    attachment,
    event,
  }: {
    attachment: Attachment;
    event:
      | { kind: 'data'; stream: TenantLogStream; text: string }
      | { kind: 'gap'; droppedBytes: number };
  }): void {
    this.#publish({
      ...attachment.source,
      sourceId: attachment.sourceId,
      sequence: attachment.nextSequence,
      observedAt: nowTimestamp(),
      ...event,
    });
    attachment.nextSequence += 1;
  }
}

async function listen({
  server,
  socketPath,
}: {
  server: Server;
  socketPath: string;
}): Promise<void> {
  const listening = Promise.withResolvers<void>();
  const onError = (error: Error) => {
    server.off('listening', onListening);
    listening.reject(error);
  };
  const onListening = () => {
    server.off('error', onError);
    listening.resolve();
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(socketPath);
  await listening.promise;
  server.on('error', (error) => {
    logger.warn({ message: 'tenant log socket failed', socketPath, error: error.message });
  });
}

async function close(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
