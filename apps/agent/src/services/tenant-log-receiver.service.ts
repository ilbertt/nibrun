import { FileSystem, Path, type Socket } from '@effect/platform';
import { BunSocketServer } from '@effect/platform-bun';
import type { InstanceId, TenantLogStream } from '@repo/protocol';
import { Deferred, Effect, Either, Exit, Ref, Scope } from 'effect';
import { nowTimestamp } from '#lib/clock.ts';
import { decodeFrames, EMPTY_BUFFER } from '#logs/guest-protocol.ts';
import type { TenantLogSource } from '#logs/vsock.ts';
import { TenantLogQueue } from '#services/tenant-log-queue.service.ts';

const PRIVATE_SOCKET_MODE = 0o600;
/** The peer is a kernel the tenant controls, and every accepted socket costs the host a decoder. */
const MAX_GUEST_CONNECTIONS = 4;

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

    /** The duplex is only opened by `run`, so a connection over the cap is opened to be closed. */
    const refuse = (socket: Socket.Socket) =>
      Effect.gen(function* () {
        const opened = yield* Deferred.make<void>();
        yield* Effect.raceFirst(
          socket.run(() => Effect.void, {
            onOpen: Effect.asVoid(Deferred.succeed(opened, undefined)),
          }),
          Deferred.await(opened),
        ).pipe(Effect.ignore);
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
                  ? refuse(socket)
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

    const detach = Effect.fn('TenantLogReceiver.detach')(function* (instanceId: InstanceId) {
      yield* Effect.annotateCurrentSpan({ instanceId });
      const attachment = (yield* Ref.get(attachments)).get(instanceId);
      if (!attachment) {
        return;
      }
      yield* Ref.update(attachments, (current) => {
        const next = new Map(current);
        next.delete(instanceId);
        return next;
      });
      yield* Scope.close(attachment.scope, Exit.void);
      yield* fs.remove(attachment.socketPath, { force: true });
    });

    const attach = Effect.fn('TenantLogReceiver.attach')(function* ({
      source,
      socketPath,
    }: {
      source: TenantLogSource;
      socketPath: string;
    }) {
      yield* Effect.annotateCurrentSpan({ instanceId: source.instanceId, appId: source.appId });
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
        Effect.onError(() => Scope.close(scope, Exit.void)),
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
  dependencies: [TenantLogQueue.Default],
}) {}
