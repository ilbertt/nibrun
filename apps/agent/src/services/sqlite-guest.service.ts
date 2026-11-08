import type { SqliteQuery } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { connectGuestSqlite } from '#lib/sqlite/client.ts';
import { SqliteSessionUnavailable } from '#lib/sqlite/sessions.ts';
import { guestVsockPath } from '#lib/vm/vsock.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { AppWaker } from '#services/app-waker.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { GuestActivity } from '#services/guest-activity.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';

export class SqliteGuest extends Effect.Service<SqliteGuest>()('SqliteGuest', {
  effect: Effect.gen(function* () {
    const state = yield* AgentState;
    const cache = yield* DesiredStateCache;
    const activity = yield* GuestActivity;
    const waker = yield* AppWaker;
    const vms = yield* VmManager;
    function recordFor(query: SqliteQuery) {
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

    function connect(query: SqliteQuery) {
      return Effect.gen(function* () {
        yield* activity.hold(query.appId);
        const record = yield* recordFor(query);
        if (record.state === 'idle') {
          yield* waker
            .wake(query.appId)
            .pipe(Effect.mapError(() => new SqliteSessionUnavailable()));
        }
        yield* recordFor(query);
        return yield* connectGuestSqlite({
          socketPath: guestVsockPath({ workingDir: vms.workingDir(query.appId) }),
        });
      });
    }
    return { available: (query: SqliteQuery) => recordFor(query).pipe(Effect.asVoid), connect };
  }),
  dependencies: [
    AgentState.Default,
    DesiredStateCache.Default,
    GuestActivity.Default,
    AppWaker.Default,
    VmManager.Default,
  ],
}) {}
