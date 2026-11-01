import {
  type AgentSession,
  CronListingSchema,
  type CronQuery,
  type CronQueryResult,
  parseMessage,
} from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { Duration, Effect } from 'effect';
import type { ControlPlaneClient } from '#lib/control/client.ts';
import type { HostReportedState as NibrunnerReport } from '#lib/nibrunner/reported.gen.ts';
import { decode } from '#lib/protocol.ts';

const ListingsSchema = Type.Array(CronListingSchema);
const IDLE_POLL_FLOOR = '5 seconds';
const UNAVAILABLE = 'Cron registrations are not available for this deployment.';

export function nibrunnerCronListings(value: NibrunnerReport) {
  return decode(function listings() {
    return value.cron === undefined || value.cron === null
      ? []
      : parseMessage({ schema: ListingsSchema, value: value.cron });
  });
}

type Listings = Effect.Effect.Success<ReturnType<typeof nibrunnerCronListings>>;

function answer<E, R>({
  query,
  listings,
}: {
  query: CronQuery;
  listings: Effect.Effect<Listings, E, R>;
}) {
  return listings.pipe(
    Effect.map(function current(available): CronQueryResult {
      const listing = available.find(
        (candidate) =>
          candidate.appId === query.appId && candidate.deploymentId === query.deploymentId,
      );
      return {
        queryId: query.queryId,
        outcome:
          listing === undefined
            ? { status: 'failed', message: UNAVAILABLE }
            : { status: 'listed', listing },
      };
    }),
    Effect.catchAll(() =>
      Effect.succeed({
        queryId: query.queryId,
        outcome: { status: 'failed', message: UNAVAILABLE },
      } satisfies CronQueryResult),
    ),
  );
}

export function pollNibrunnerCron<E, R>({
  control,
  session,
  listings,
}: {
  control: ControlPlaneClient;
  session: AgentSession;
  listings: Effect.Effect<Listings, E, R>;
}) {
  return Effect.gen(function* () {
    const [held, response] = yield* Effect.timed(
      control.fetchCronQuery({
        sessionToken: session.sessionToken,
        request: {
          servedDeployments: (yield* listings).map(({ appId, deploymentId }) => ({
            appId,
            deploymentId,
          })),
        },
      }),
    );
    if (response.result === 'none') {
      return yield* Effect.sleep(Duration.subtract(IDLE_POLL_FLOOR, held));
    }
    yield* control.sendCronQueryResult({
      sessionToken: session.sessionToken,
      result: yield* answer({ query: response.query, listings }),
    });
  });
}
