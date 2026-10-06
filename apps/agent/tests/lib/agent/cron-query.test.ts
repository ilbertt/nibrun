import { describe, expect, test } from 'bun:test';
import {
  AgentSessionSchema,
  type CronQuery,
  type CronQueryRequest,
  type CronQueryResult,
  DeploymentIdSchema,
  HostVersionsSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Layer, Ref, TestClock, TestContext } from 'effect';
import { cronQueryLoop } from '#lib/agent/cron-query.ts';
import { ControlPlaneError } from '#lib/control/client.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { CRON_JOB, CRON_QUERY, registeredCronHost } from '#tests/support/crons.ts';
import {
  desiredInstance,
  desiredState,
  HOST_ID,
  LOG_SOURCE,
  POLL_SETTINGS_FIXTURE,
} from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { HTTP_UNAUTHORIZED } from '#tests/support/server.ts';

const run = provided(Layer.mergeAll(platform, TestContext.TestContext, agentConfig()));
const SESSION = Value.Parse(AgentSessionSchema, {
  hostId: HOST_ID,
  sessionToken: 'session-token',
  expiresAt: '2026-10-01T20:00:00Z',
  poll: POLL_SETTINGS_FIXTURE,
});
const VERSIONS = Value.Parse(HostVersionsSchema, {
  agent: 'a',
  guestImage: 'b',
  zerofs: 'c',
  firecracker: 'd',
});
const POLLS_ACROSS_TWO_FLOORS = 3;

function unreached() {
  return Effect.dieMessage('cron queries use only the cron query and result routes');
}

function queryApi(queued: CronQuery[]) {
  return Effect.gen(function* () {
    const polls: CronQueryRequest[] = [];
    const answers: CronQueryResult[] = [];
    const onPoll = yield* Ref.make<Effect.Effect<void, ControlPlaneError>>(Effect.void);
    const layer = Layer.succeed(
      ControlPlane,
      ControlPlane.make({
        openSession: unreached,
        fetchDesiredState: unreached,
        sendReportedState: unreached,
        fetchFilesystemQuery: unreached,
        sendFilesystemQueryResult: unreached,
        fetchCronQuery: ({ request }) =>
          Effect.gen(function* () {
            polls.push(request);
            yield* Effect.flatten(Ref.get(onPoll));
            const query = queued.shift();
            return query ? { result: 'query' as const, query } : { result: 'none' as const };
          }),
        sendCronQueryResult: ({ result }) =>
          Effect.sync(() => {
            answers.push(result);
          }),
      }),
    );
    return { polls, answers, layer, onPoll };
  });
}

function startLoop({
  host,
  api,
  expired,
}: {
  host: Effect.Effect.Success<ReturnType<typeof registeredCronHost>>;
  api: Effect.Effect.Success<ReturnType<typeof queryApi>>;
  expired: ControlPlaneError[];
}) {
  const session = Layer.succeed(
    AgentSessionHolder,
    AgentSessionHolder.make({
      versions: VERSIONS,
      current: Effect.succeed(SESSION),
      pollSettings: Effect.succeed(SESSION.poll),
      onExpired: (error) =>
        Effect.sync(() => {
          if (error.isSessionExpired) {
            expired.push(error);
          }
        }),
    }),
  );
  return cronQueryLoop.pipe(
    Effect.provide(Layer.mergeAll(host.layer, api.layer, session)),
    Effect.forkScoped,
  );
}

describe('agent cron query loop', () => {
  test('advertises suspended deployments and immediately answers without guest services', () =>
    run(
      Effect.gen(function* () {
        const host = yield* registeredCronHost(yield* temporaryDirectory);
        yield* host.cache.accept(
          desiredState({ instances: [desiredInstance({ desiredState: 'stopped' })] }),
        );
        const api = yield* queryApi([CRON_QUERY]);
        yield* startLoop({ host, api, expired: [] });
        yield* TestClock.adjust('0 millis');
        expect(api.polls).toHaveLength(2);
        expect(api.polls[0]?.servedDeployments).toEqual([LOG_SOURCE]);
        expect(api.answers).toHaveLength(1);
        const result = api.answers[0]!;
        expect(result.queryId).toBe(CRON_QUERY.queryId);
        if (result.outcome.status !== 'listed') {
          throw new Error('the registered deployment must be listed');
        }
        expect(result.outcome.listing.enabled).toBe(false);
        expect(result.outcome.listing.jobs[0]).toMatchObject(CRON_JOB);
      }),
    ));

  test('an immediate idle reply waits out the poll floor', () =>
    run(
      Effect.gen(function* () {
        const host = yield* registeredCronHost(yield* temporaryDirectory);
        const api = yield* queryApi([]);
        yield* startLoop({ host, api, expired: [] });
        yield* TestClock.adjust('12 seconds');
        expect(api.polls).toHaveLength(POLLS_ACROSS_TWO_FLOORS);
        expect(api.answers).toEqual([]);
      }),
    ));

  test('a stale deployment query receives a failure instead of timing out', () =>
    run(
      Effect.gen(function* () {
        const host = yield* registeredCronHost(yield* temporaryDirectory);
        const api = yield* queryApi([
          { ...CRON_QUERY, deploymentId: Value.Parse(DeploymentIdSchema, 'dep-2') },
        ]);
        yield* startLoop({ host, api, expired: [] });
        yield* TestClock.adjust('0 millis');
        expect(api.answers[0]?.outcome.status).toBe('failed');
        expect(api.polls).toHaveLength(2);
      }),
    ));

  test('an expired session is invalidated and the query loop recovers', () =>
    run(
      Effect.gen(function* () {
        const host = yield* registeredCronHost(yield* temporaryDirectory);
        const api = yield* queryApi([]);
        const expired: ControlPlaneError[] = [];
        const error = new ControlPlaneError({
          route: '/cron-query',
          status: HTTP_UNAUTHORIZED,
          body: 'expired',
        });
        yield* Ref.set(
          api.onPoll,
          Effect.fail(error).pipe(Effect.ensuring(Ref.set(api.onPoll, Effect.void))),
        );
        yield* startLoop({ host, api, expired });
        yield* TestClock.adjust('2 seconds');
        expect(expired).toEqual([error]);
        expect(api.polls).toHaveLength(2);
      }),
    ));
});
