import { Buffer } from 'node:buffer';
import { FileSystem, Path, type Socket } from '@effect/platform';
import { BunSocketServer } from '@effect/platform-bun';
import type { AppId } from '@repo/protocol';
import { Deferred, Effect, Either, Exit, Option, Ref, Scope } from 'effect';
import {
  type CronRegistrationRequest,
  cronRegistrationReply,
  decodeCronRegistration,
  MalformedCronRegistration,
} from '#lib/cron/registration-protocol.ts';
import { type CronDeployment, CronDeploymentMismatch } from '#lib/cron/registry.ts';
import { CronRegistry } from '#services/cron-registry.service.ts';

const PRIVATE_SOCKET_MODE = 0o600;
const MAX_CONNECTIONS = 4;
const REQUEST_TIMEOUT = '5 seconds';

type Attachment = {
  readonly source: CronDeployment;
  readonly socketPath: string;
  readonly scope: Scope.CloseableScope;
};

export class CronRegistrationReceiver extends Effect.Service<CronRegistrationReceiver>()(
  'CronRegistrationReceiver',
  {
    scoped: Effect.gen(function* () {
      const registry = yield* CronRegistry;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const attachments = yield* Ref.make(new Map<AppId, Attachment>());

      function answer({
        request,
        source,
      }: {
        request: CronRegistrationRequest;
        source: CronDeployment;
      }) {
        return Effect.gen(function* () {
          if (request.verb === 'replace') {
            yield* registry.replaceCrontab({ ...source, text: request.text });
            return '';
          }
          const table = yield* registry.get({ appId: source.appId });
          if (Option.isNone(table) || table.value.deploymentId !== source.deploymentId) {
            return yield* new CronDeploymentMismatch();
          }
          return table.value.crontab ?? '';
        });
      }

      function pump({
        socket,
        source,
        allowed,
      }: {
        socket: Socket.Socket;
        source: CronDeployment;
        allowed: boolean;
      }) {
        return Effect.scoped(
          Effect.gen(function* () {
            const write = yield* socket.writer;
            const finished = yield* Deferred.make<void>();
            const input = yield* Ref.make<{ buffered: Buffer; complete: boolean }>({
              buffered: Buffer.alloc(0),
              complete: false,
            });
            function reply({ status, text }: Parameters<typeof cronRegistrationReply>[0]) {
              return write(cronRegistrationReply({ status, text })).pipe(
                Effect.andThen(Deferred.succeed(finished, undefined)),
                Effect.asVoid,
              );
            }
            yield* Effect.raceFirst(
              socket.run(
                (chunk) =>
                  allowed
                    ? Effect.gen(function* () {
                        const decoded = yield* Ref.modify(input, (current) => {
                          const result = current.complete
                            ? Either.left(new MalformedCronRegistration())
                            : decodeCronRegistration({ buffered: current.buffered, chunk });
                          return [
                            result,
                            Either.isRight(result)
                              ? {
                                  buffered: result.right.buffered,
                                  complete: Option.isSome(result.right.request),
                                }
                              : { ...current, complete: true },
                          ];
                        });
                        if (Either.isLeft(decoded)) {
                          return yield* reply({ status: 'rejected', text: decoded.left.message });
                        }
                        if (Option.isNone(decoded.right.request)) {
                          return;
                        }
                        yield* answer({ request: decoded.right.request.value, source }).pipe(
                          Effect.matchEffect({
                            onSuccess: (text) => reply({ status: 'ok', text }),
                            onFailure: (error) =>
                              reply({ status: 'rejected', text: error.message }),
                          }),
                        );
                      })
                    : Effect.void,
                {
                  onOpen: allowed
                    ? Effect.void
                    : Effect.asVoid(
                        reply({
                          status: 'rejected',
                          text: 'Too many concurrent cron registration requests.',
                        }),
                      ).pipe(Effect.ignore),
                },
              ),
              Deferred.await(finished),
            ).pipe(Effect.timeout(REQUEST_TIMEOUT));
          }),
        );
      }

      const detach = Effect.fn('CronRegistrationReceiver.detach')(function* (appId: AppId) {
        const attachment = (yield* Ref.get(attachments)).get(appId);
        if (!attachment) {
          return;
        }
        yield* Ref.update(attachments, (current) => {
          const next = new Map(current);
          next.delete(appId);
          return next;
        });
        yield* Scope.close(attachment.scope, Exit.void);
        yield* fs.remove(attachment.socketPath, { force: true });
      });

      const attach = Effect.fn('CronRegistrationReceiver.attach')(function* ({
        source,
        socketPath,
      }: {
        source: CronDeployment;
        socketPath: string;
      }) {
        const existing = (yield* Ref.get(attachments)).get(source.appId);
        if (
          existing?.socketPath === socketPath &&
          existing.source.deploymentId === source.deploymentId
        ) {
          return;
        }
        yield* detach(source.appId);
        yield* fs.makeDirectory(path.dirname(socketPath), { recursive: true });
        yield* fs.remove(socketPath, { force: true });
        const scope = yield* Scope.make();
        const attachment = {
          source: { appId: source.appId, deploymentId: source.deploymentId },
          socketPath,
          scope,
        };
        yield* Scope.extend(
          Effect.gen(function* () {
            const connections = yield* Ref.make(0);
            const server = yield* BunSocketServer.make({ path: socketPath });
            yield* fs.chmod(socketPath, PRIVATE_SOCKET_MODE);
            yield* Effect.forkScoped(
              server.run((socket) =>
                Effect.acquireUseRelease(
                  Ref.updateAndGet(connections, (count) => count + 1),
                  (count) =>
                    pump({
                      socket,
                      source: attachment.source,
                      allowed: count <= MAX_CONNECTIONS,
                    }).pipe(
                      Effect.catchAll((error) =>
                        Effect.logWarning('cron registration connection failed', error),
                      ),
                    ),
                  () => Ref.update(connections, (count) => count - 1),
                ),
              ),
            );
          }),
          scope,
        ).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
        yield* Ref.update(attachments, (current) => new Map(current).set(source.appId, attachment));
      });

      yield* Effect.addFinalizer(() =>
        Effect.flatMap(Ref.get(attachments), (current) =>
          Effect.forEach([...current.keys()], detach, { discard: true }),
        ).pipe(Effect.ignore),
      );
      return { attach, detach };
    }),
    dependencies: [CronRegistry.Default],
  },
) {}
