import { FileSystem } from '@effect/platform';
import {
  type SqliteOperation,
  type SqliteQuery,
  SqliteQueryIdSchema,
  SqliteSessionIdSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Context, Effect, Layer, Ref } from 'effect';
import { guestVsockPath } from '#lib/vm/vsock.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { AppWaker } from '#services/app-waker.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { GuestActivity } from '#services/guest-activity.service.ts';
import { SqliteSessions } from '#services/sqlite-sessions.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  desiredInstance,
  desiredState,
  instanceRecord,
} from '#tests/support/fixtures.ts';
import { servingSqliteGuest } from '#tests/support/guest-sqlite.ts';
import { temporaryDirectory } from '#tests/support/run.ts';

export function sqliteQuery(operation: SqliteOperation): SqliteQuery {
  return {
    queryId: Value.Parse(SqliteQueryIdSchema, crypto.randomUUID()),
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    sessionId: Value.Parse(SqliteSessionIdSchema, 'sqlite-session-1'),
    operation,
  };
}

export function sqliteHost(responses: readonly Buffer[]) {
  return Effect.gen(function* () {
    const state = yield* AgentState;
    const activity = yield* GuestActivity;
    const directory = yield* temporaryDirectory;
    const guest = yield* servingSqliteGuest({
      directory,
      responses,
      fragmented: false,
      handshake: 'OK 1024\n',
    });
    yield* (yield* FileSystem.FileSystem).symlink(
      guest.socketPath,
      guestVsockPath({ workingDir: directory }),
    );
    const cache = yield* DesiredStateCache.pipe(
      Effect.provide(
        DesiredStateCache.DefaultWithoutDependencies.pipe(
          Layer.provide(agentConfig({ desiredStateFile: `${directory}/desired.json` })),
        ),
      ),
    );
    yield* cache.accept(desiredState({ instances: [desiredInstance()] }));
    yield* state.modify((current) => ({ ...current, isolated: true }));
    yield* state.putRecord(instanceRecord({ state: 'running' }));
    const wakes = yield* Ref.make(0);
    const onWake = yield* Ref.make(Effect.void);
    const dependencies = Layer.mergeAll(
      Layer.succeed(AgentState, state),
      Layer.succeed(GuestActivity, activity),
      Layer.succeed(DesiredStateCache, cache),
      Layer.succeed(
        AppWaker,
        AppWaker.make({
          wake: () =>
            Effect.gen(function* () {
              yield* Ref.update(wakes, (count) => count + 1);
              yield* yield* Ref.get(onWake);
              yield* state.updateRecord({
                appId: APP_ID,
                change: (record) => ({ ...record, state: 'running', stopRequested: false }),
              });
            }),
        }),
      ),
      Layer.succeed(
        VmManager,
        VmManager.make({
          workingDir: () => directory,
          attachReceivers: () => Effect.void,
          boot: () => Effect.void,
          sleep: () => Effect.succeed(undefined),
          wake: () => Effect.void,
          stop: () => Effect.void,
          discard: () => Effect.void,
        }),
      ),
    );
    const services = yield* Layer.build(
      SqliteSessions.DefaultWithoutDependencies.pipe(Layer.provide(dependencies)),
    );
    const sessions = Context.get(services, SqliteSessions);
    yield* sessions.syncDeployments({ instances: [desiredInstance()] });
    return { sessions, guest, cache, wakes, onWake };
  });
}
