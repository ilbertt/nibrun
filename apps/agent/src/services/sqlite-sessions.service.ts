import type { DesiredInstance, SqliteOutcome, SqliteQuery, SqliteSessionId } from '@repo/protocol';
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Option,
  Scope,
  SynchronizedRef,
} from 'effect';
import { connectGuestSqlite } from '#lib/sqlite/client.ts';
import {
  SQLITE_MAX_GUEST_SESSIONS,
  SQLITE_MAX_HOST_SESSIONS,
  SQLITE_SESSION_IDLE_TIMEOUT_MS,
  type SqliteClient,
  type SqliteRegistry,
  type SqliteSession,
  SqliteSessionCapacity,
  type SqliteSessionError,
  type SqliteSessionExpiry,
  SqliteSessionUnavailable,
  sqliteFailure,
} from '#lib/sqlite/sessions.ts';
import { guestVsockPath } from '#lib/vm/vsock.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { AppWaker } from '#services/app-waker.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { GuestActivity } from '#services/guest-activity.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';

export class SqliteSessions extends Effect.Service<SqliteSessions>()('SqliteSessions', {
  scoped: Effect.gen(function* () {
    const state = yield* AgentState;
    const cache = yield* DesiredStateCache;
    const activity = yield* GuestActivity;
    const waker = yield* AppWaker;
    const vms = yield* VmManager;
    const registry = yield* SynchronizedRef.make<SqliteRegistry>({
      deployments: new Map(),
      sessions: new Map(),
    });

    function available(query: SqliteQuery) {
      return Effect.gen(function* () {
        const wanted = Option.getOrUndefined(yield* cache.latest)?.instances.find(
          (instance) => instance.appId === query.appId,
        );
        const snapshot = yield* state.snapshot;
        const record = snapshot.records.get(query.appId);
        if (
          !snapshot.isolated ||
          wanted?.deploymentId !== query.deploymentId ||
          wanted.desiredState === 'stopped' ||
          record?.deploymentId !== query.deploymentId ||
          !record.desiredRunning ||
          (record.state !== 'idle' &&
            (record.stopRequested || !['running', 'starting', 'unhealthy'].includes(record.state)))
        ) {
          return yield* new SqliteSessionUnavailable();
        }
        return record;
      });
    }

    function remove(sessionId: SqliteSessionId) {
      return SynchronizedRef.modify(registry, (current) => {
        const session = current.sessions.get(sessionId);
        const sessions = new Map(current.sessions);
        sessions.delete(sessionId);
        return [session, { ...current, sessions }];
      });
    }

    function close(sessionId: SqliteSessionId) {
      return Effect.flatMap(remove(sessionId), (session) =>
        session === undefined ? Effect.void : Scope.close(session.scope, Exit.void),
      ).pipe(Effect.uninterruptible);
    }

    function reserve(query: SqliteQuery) {
      return Effect.gen(function* () {
        const session: SqliteSession = {
          appId: query.appId,
          deploymentId: query.deploymentId,
          scope: yield* Scope.make(),
          ready: yield* Deferred.make<SqliteClient, SqliteSessionError>(),
          touched: yield* Clock.currentTimeMillis,
        };
        return yield* SynchronizedRef.modifyEffect(
          registry,
          (
            current,
          ): Effect.Effect<
            readonly [SqliteSession, SqliteRegistry],
            SqliteSessionCapacity | SqliteSessionUnavailable
          > => {
            if (
              current.deployments.get(query.appId) !== query.deploymentId ||
              current.sessions.has(query.sessionId)
            ) {
              return Effect.fail(new SqliteSessionUnavailable());
            }
            const guestSessions = [...current.sessions.values()].filter(
              (held) => held.appId === query.appId,
            ).length;
            if (
              current.sessions.size >= SQLITE_MAX_HOST_SESSIONS ||
              guestSessions >= SQLITE_MAX_GUEST_SESSIONS
            ) {
              return Effect.fail(new SqliteSessionCapacity());
            }
            return Effect.succeed([
              session,
              { ...current, sessions: new Map(current.sessions).set(query.sessionId, session) },
            ] as const);
          },
        ).pipe(Effect.onError(() => Scope.close(session.scope, Exit.void)));
      });
    }

    function expire(query: SqliteQuery) {
      return Effect.gen(function* () {
        for (;;) {
          const now = yield* Clock.currentTimeMillis;
          const held = yield* SynchronizedRef.modify(
            registry,
            (current): readonly [SqliteSessionExpiry, SqliteRegistry] => {
              const session = current.sessions.get(query.sessionId);
              if (session === undefined || now - session.touched < SQLITE_SESSION_IDLE_TIMEOUT_MS) {
                return [{ session, expired: false }, current] as const;
              }
              const sessions = new Map(current.sessions);
              sessions.delete(query.sessionId);
              return [
                { session, expired: true },
                { ...current, sessions },
              ] as const;
            },
          );
          if (held.session === undefined) {
            return;
          }
          if (held.expired) {
            return yield* Scope.close(held.session.scope, Exit.void);
          }
          yield* Effect.sleep(
            Duration.millis(SQLITE_SESSION_IDLE_TIMEOUT_MS - (now - held.session.touched)),
          );
        }
      });
    }

    function open(query: SqliteQuery) {
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (query.operation.type !== 'open') {
            return yield* new SqliteSessionUnavailable();
          }
          const path = query.operation.path;
          const session = yield* reserve(query);
          const opening = activity.run({
            appId: query.appId,
            effect: Effect.gen(function* () {
              const record = yield* available(query);
              if (record.state === 'idle') {
                yield* waker
                  .wake(query.appId)
                  .pipe(Effect.mapError(() => new SqliteSessionUnavailable()));
              }
              yield* available(query);
              const client = yield* connectGuestSqlite({
                socketPath: guestVsockPath({ workingDir: vms.workingDir(query.appId) }),
              });
              yield* Scope.addFinalizer(session.scope, client.close);
              yield* client.open(path);
              yield* Deferred.succeed(session.ready, client);
              yield* Effect.never;
            }).pipe(
              Effect.onError((cause) => Deferred.failCause(session.ready, cause)),
              Effect.onInterrupt(() =>
                Deferred.fail(session.ready, new SqliteSessionUnavailable()),
              ),
            ),
          });
          yield* Effect.forkIn(Effect.scoped(restore(opening)), session.scope);
          yield* Effect.forkIn(restore(expire(query)), session.scope);
          return yield* restore(Deferred.await(session.ready)).pipe(
            Effect.as({ status: 'opened' } as const),
            Effect.onError(() => close(query.sessionId)),
            Effect.onInterrupt(() => close(query.sessionId)),
          );
        }),
      );
    }

    function held(query: SqliteQuery) {
      return Effect.gen(function* () {
        yield* available(query);
        const now = yield* Clock.currentTimeMillis;
        return yield* SynchronizedRef.modifyEffect(registry, (current) => {
          const session = current.sessions.get(query.sessionId);
          if (session?.appId !== query.appId || session.deploymentId !== query.deploymentId) {
            return Effect.fail(new SqliteSessionUnavailable());
          }
          return Effect.succeed([
            session,
            {
              ...current,
              sessions: new Map(current.sessions).set(query.sessionId, {
                ...session,
                touched: now,
              }),
            },
          ] as const);
        });
      });
    }

    function execute(query: SqliteQuery) {
      return Effect.gen(function* () {
        const session = yield* held(query);
        if (query.operation.type === 'close') {
          yield* close(query.sessionId);
          return { status: 'closed' } as const;
        }
        const client = yield* Deferred.await(session.ready);
        if (query.operation.type !== 'pipeline') {
          return yield* new SqliteSessionUnavailable();
        }
        const fiber = yield* Effect.forkIn(client.pipeline(query.operation.body), session.scope);
        const result = yield* Fiber.join(fiber).pipe(
          Effect.ensuring(Fiber.interrupt(fiber)),
          Effect.onError(() => close(query.sessionId)),
          Effect.onInterrupt(() => close(query.sessionId)),
        );
        return { status: 'pipelined', result } as const;
      });
    }

    function request(query: SqliteQuery): Effect.Effect<SqliteOutcome> {
      const operation: Effect.Effect<SqliteOutcome, SqliteSessionError> =
        query.operation.type === 'open' ? open(query) : execute(query);
      return operation.pipe(Effect.catchAll((error) => Effect.succeed(sqliteFailure(error))));
    }

    function syncDeployments({ instances }: { instances: readonly DesiredInstance[] }) {
      return Effect.gen(function* () {
        const deployments = new Map(
          instances
            .filter((instance) => instance.desiredState !== 'stopped')
            .map((instance) => [instance.appId, instance.deploymentId] as const),
        );
        const removed = yield* SynchronizedRef.modify(registry, (current) => {
          const sessions = new Map(current.sessions);
          const scopes: Scope.CloseableScope[] = [];
          for (const [sessionId, session] of current.sessions) {
            if (deployments.get(session.appId) !== session.deploymentId) {
              sessions.delete(sessionId);
              scopes.push(session.scope);
            }
          }
          return [scopes, { deployments, sessions }];
        });
        yield* Effect.forEach(removed, (scope) => Scope.close(scope, Exit.void), { discard: true });
      }).pipe(Effect.uninterruptible);
    }

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(SynchronizedRef.get(registry), (current) =>
        Effect.forEach(
          current.sessions.values(),
          (session) => Scope.close(session.scope, Exit.void),
          { discard: true },
        ),
      ),
    );
    return { request, syncDeployments };
  }),
  dependencies: [
    AgentState.Default,
    DesiredStateCache.Default,
    GuestActivity.Default,
    AppWaker.Default,
    VmManager.Default,
  ],
}) {}
