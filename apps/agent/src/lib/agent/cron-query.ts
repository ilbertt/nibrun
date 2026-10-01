import type { CronQuery, CronQueryResult } from '@repo/protocol';
import { Duration, Effect, Option } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import { readCronListing } from '#lib/cron/listing.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';

// A floor prevents spinning if a server answers idle polls without holding them open.
const IDLE_POLL_FLOOR: Duration.DurationInput = '5 seconds';

function answer(query: CronQuery) {
  return readCronListing(query).pipe(
    Effect.match({
      onSuccess: (listing) =>
        ({
          queryId: query.queryId,
          outcome: { status: 'listed', listing },
        }) satisfies CronQueryResult,
      onFailure: (error) =>
        ({
          queryId: query.queryId,
          outcome: { status: 'failed', message: error.message },
        }) satisfies CronQueryResult,
    }),
  );
}

const pollForCronQuery = Effect.gen(function* () {
  const control = yield* ControlPlane;
  const sessions = yield* AgentSessionHolder;
  const cache = yield* DesiredStateCache;
  const session = yield* sessions.current;
  const desired = Option.getOrUndefined(yield* cache.latest);
  const [held, response] = yield* Effect.timed(
    control.fetchCronQuery({
      sessionToken: session.sessionToken,
      request: {
        servedDeployments:
          desired?.instances.map(({ appId, deploymentId }) => ({ appId, deploymentId })) ?? [],
      },
    }),
  );
  if (response.result === 'none') {
    return yield* Effect.sleep(Duration.subtract(IDLE_POLL_FLOOR, held));
  }
  yield* control.sendCronQueryResult({
    sessionToken: session.sessionToken,
    result: yield* answer(response.query),
  });
});

export const cronQueryLoop = Effect.gen(function* () {
  const sessions = yield* AgentSessionHolder;
  yield* supervised({
    once: Effect.tapErrorTag(pollForCronQuery, 'ControlPlaneError', sessions.onExpired),
    onFailure: (cause) => Effect.logWarning('cron query loop failed', cause),
    schedule: CONTROL_PLANE_BACKOFF,
  });
});
