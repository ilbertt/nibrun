import type { DesiredInstance, SqliteQuery } from '@repo/protocol';
import { Effect } from 'effect';
import { GUEST_SQLITE_VSOCK_PORT, makeGuestSqliteClient } from '#lib/sqlite/client.ts';
import { SqliteSessionUnavailable } from '#lib/sqlite/sessions.ts';
import { NibrunnerGuestConnections } from '#services/nibrunner-guest-connections.service.ts';
import { SqliteGuest } from '#services/sqlite-guest.service.ts';

export function makeNibrunnerSqliteGuest<E, R>({
  deployments,
}: {
  deployments: Effect.Effect<
    readonly Pick<DesiredInstance, 'appId' | 'deploymentId' | 'desiredState'>[],
    E,
    R
  >;
}) {
  return Effect.gen(function* () {
    const connections = yield* NibrunnerGuestConnections;
    const context = yield* Effect.context<R>();
    const current = deployments.pipe(Effect.provide(context));

    function available(query: SqliteQuery) {
      return current.pipe(
        Effect.filterOrFail(
          (instances) =>
            instances.some(
              (instance) =>
                instance.appId === query.appId &&
                instance.deploymentId === query.deploymentId &&
                instance.desiredState !== 'stopped',
            ),
          () => new SqliteSessionUnavailable(),
        ),
        Effect.mapError(() => new SqliteSessionUnavailable()),
        Effect.asVoid,
      );
    }

    function connect(query: SqliteQuery) {
      return Effect.gen(function* () {
        yield* available(query);
        const socket = yield* connections
          .connect({
            appId: query.appId,
            deploymentId: query.deploymentId,
            port: GUEST_SQLITE_VSOCK_PORT,
          })
          .pipe(Effect.mapError(() => new SqliteSessionUnavailable()));
        yield* available(query);
        return yield* makeGuestSqliteClient({ socket });
      });
    }

    return SqliteGuest.make({ available, connect });
  });
}
