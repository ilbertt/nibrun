import { join } from 'node:path';
import { FileSystem, Path, type Socket } from '@effect/platform';
import { BunSocketServer } from '@effect/platform-bun';
import type { AppId, DeploymentId, InstanceId, TenantLogStream } from '@repo/protocol';
import { Effect, Either, Ref, Scope } from 'effect';
import { nowTimestamp } from '#lib/clock.ts';
import { decodeFrames, EMPTY_BUFFER } from '#logs/guest-protocol.ts';
import { TenantLogQueue } from '#logs/queue.ts';

export const TENANT_LOG_VSOCK_PORT = 51000;
export const TENANT_LOG_VSOCK_FILENAME = 'logs.vsock';

const PRIVATE_SOCKET_MODE = 0o600;
/** The peer is a kernel the tenant controls, and every accepted socket costs the host a decoder. */
const MAX_GUEST_CONNECTIONS = 4;

export type TenantLogSource = {
  readonly appId: AppId;
  readonly deploymentId: DeploymentId;
  readonly instanceId: InstanceId;
};

type LogEventBody =
  | { readonly kind: 'data'; readonly stream: TenantLogStream; readonly text: string }
  | { readonly kind: 'gap'; readonly droppedBytes: number };

type Attachment = {
  readonly sourceId: string;
  readonly socketPath: string;
  readonly source: Ref.Ref<TenantLogSource>;
  readonly sequence: Ref.Ref<number>;
  readonly scope: Scope.CloseableScope;
};

export const tenantLogSocketPath = ({ workingDir }: { workingDir: string }): string =>
  join(workingDir, `${TENANT_LOG_VSOCK_FILENAME}_${TENANT_LOG_VSOCK_PORT}`);

export class TenantLogReceiver extends Effect.Service<TenantLogReceiver>()('TenantLogReceiver', {
  scoped: Effect.gen(function* () {
    const logs = yield* TenantLogQueue;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const attachments = yield* Ref.make(new Map<InstanceId, Attachment>());
    const dropped = yield* Ref.make(0);

    const countDrop = Effect.gen(function* () {
      const total = yield* Ref.updateAndGet(dropped, (count) => count + 1);
      // Powers of two only: a full buffer would otherwise log once per dropped event.
      if ((total & (total - 1)) === 0) {
        yield* Effect.logWarning('tenant log upload buffer full').pipe(
          Effect.annotateLogs({ droppedEvents: total }),
        );
      }
    });

    const emit = ({ attachment, event }: { attachment: Attachment; event: LogEventBody }) =>
      Effect.gen(function* () {
        const accepted = yield* logs.publish({
          ...(yield* Ref.get(attachment.source)),
          sourceId: attachment.sourceId,
          sequence: yield* Ref.getAndUpdate(attachment.sequence, (value) => value + 1),
          observedAt: yield* nowTimestamp,
          ...event,
        });
        if (!accepted) {
          yield* countDrop;
        }
      });

    const pump = ({ attachment, socket }: { attachment: Attachment; socket: Socket.Socket }) =>
      Effect.gen(function* () {
        const buffered = yield* Ref.make(EMPTY_BUFFER);
        const text: Record<TenantLogStream, TextDecoder> = {
          stdout: new TextDecoder(),
          stderr: new TextDecoder(),
        };

        yield* socket.run((chunk) =>
          Effect.gen(function* () {
            const decoded = decodeFrames({ buffered: yield* Ref.get(buffered), chunk });
            if (Either.isLeft(decoded)) {
              return yield* decoded.left;
            }
            yield* Ref.set(buffered, decoded.right.rest);
            for (const frame of decoded.right.frames) {
              if (frame.kind === 'gap') {
                yield* emit({ attachment, event: frame });
                continue;
              }
              const decodedText = text[frame.stream].decode(frame.bytes, { stream: true });
              if (decodedText.length > 0) {
                yield* emit({
                  attachment,
                  event: { kind: 'data', stream: frame.stream, text: decodedText },
                });
              }
            }
          }),
        );

        for (const stream of ['stdout', 'stderr'] as const) {
          const remainder = text[stream].decode();
          if (remainder.length > 0) {
            yield* emit({ attachment, event: { kind: 'data', stream, text: remainder } });
          }
        }
      });

    const serve = ({ attachment }: { attachment: Attachment }) =>
      Effect.gen(function* () {
        const connections = yield* Ref.make(0);
        const server = yield* BunSocketServer.make({ path: attachment.socketPath });
        yield* fs.chmod(attachment.socketPath, PRIVATE_SOCKET_MODE);
        yield* Effect.forkScoped(
          server.run((socket) =>
            Effect.acquireUseRelease(
              Ref.updateAndGet(connections, (count) => count + 1),
              (count) =>
                count > MAX_GUEST_CONNECTIONS
                  ? Effect.void
                  : pump({ attachment, socket }).pipe(
                      Effect.catchAll((error) =>
                        Effect.logWarning('tenant log connection failed', error),
                      ),
                    ),
              () => Ref.update(connections, (count) => count - 1),
            ),
          ),
        );
      });

    const detach = (instanceId: InstanceId) =>
      Effect.gen(function* () {
        const attachment = (yield* Ref.get(attachments)).get(instanceId);
        if (!attachment) {
          return;
        }
        yield* Ref.update(attachments, (current) => {
          const next = new Map(current);
          next.delete(instanceId);
          return next;
        });
        yield* Scope.close(attachment.scope, Effect.void as never);
        yield* fs.remove(attachment.socketPath, { force: true });
      });

    const attach = ({
      source,
      socketPath,
    }: {
      source: TenantLogSource;
      socketPath: string;
    }) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(attachments);
        const existing = current.get(source.instanceId);
        if (existing?.socketPath === socketPath) {
          return yield* Ref.set(existing.source, source);
        }
        for (const [instanceId, attached] of current) {
          if (instanceId === source.instanceId || attached.socketPath === socketPath) {
            yield* detach(instanceId);
          }
        }

        yield* fs.makeDirectory(path.dirname(socketPath), { recursive: true });
        yield* fs.remove(socketPath, { force: true });

        const scope = yield* Scope.make();
        const attachment: Attachment = {
          sourceId: yield* Effect.sync(() => crypto.randomUUID()),
          socketPath,
          source: yield* Ref.make(source),
          sequence: yield* Ref.make(0),
          scope,
        };
        yield* Scope.extend(serve({ attachment }), scope).pipe(
          Effect.onError(() => Scope.close(scope, Effect.void as never)),
        );
        yield* Ref.update(attachments, (all) => new Map(all).set(source.instanceId, attachment));
      });

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(Ref.get(attachments), (all) =>
        Effect.forEach([...all.keys()], detach, { discard: true }),
      ).pipe(Effect.ignore),
    );

    return { attach, detach };
  }),
}) {}
