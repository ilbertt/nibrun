import { Effect, Option } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import { makeSqliteQueryPoll } from '#lib/sqlite/query-poll.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { SqliteSessions } from '#services/sqlite-sessions.service.ts';

export const sqliteQueryLoop = Effect.gen(function* () {
  const holder = yield* AgentSessionHolder;
  const cache = yield* DesiredStateCache;
  const once = yield* makeSqliteQueryPoll({
    control: yield* ControlPlane,
    currentSession: holder.current,
    servedDeployments: cache.latest.pipe(
      Effect.map(
        (desired) =>
          Option.getOrUndefined(desired)?.instances.map(({ appId, deploymentId }) => ({
            appId,
            deploymentId,
          })) ?? [],
      ),
    ),
    onExpired: holder.onExpired,
    sessions: yield* SqliteSessions,
  });
  yield* supervised({
    once,
    onFailure: () => Effect.logWarning('SQLite query poll failed'),
    schedule: CONTROL_PLANE_BACKOFF,
  });
}).pipe(Effect.scoped);
