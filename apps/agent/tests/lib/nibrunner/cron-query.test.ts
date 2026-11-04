import { expect, test } from 'bun:test';
import {
  AgentSessionSchema,
  CronListingSchema,
  CronQueryResultSchema,
  CronQuerySchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import { makeControlPlaneClient } from '#lib/control/client.ts';
import { nibrunnerCronListings, pollNibrunnerCron } from '#lib/nibrunner/cron-query.ts';
import type { CronListing } from '#lib/nibrunner/reported.gen.ts';
import { APP_ID, DEPLOYMENT_ID, HOST_ID, POLL_SETTINGS_FIXTURE } from '#tests/support/fixtures.ts';
import { nibrunnerReport } from '#tests/support/nibrunner.ts';
import { runScoped } from '#tests/support/run.ts';
import { serving } from '#tests/support/server.ts';

const session = Value.Parse(AgentSessionSchema, {
  hostId: HOST_ID,
  sessionToken: 'token',
  expiresAt: '2099-01-01T00:00:00Z',
  poll: POLL_SETTINGS_FIXTURE,
});
const query = Value.Parse(CronQuerySchema, {
  queryId: 'query',
  appId: APP_ID,
  deploymentId: DEPLOYMENT_ID,
});
const listing = Value.Parse(CronListingSchema, {
  appId: APP_ID,
  deploymentId: DEPLOYMENT_ID,
  enabled: false,
  timeZone: 'UTC',
  jobs: [
    {
      jobId: 'cron-job',
      schedule: '@daily',
      command: 'echo task',
      environment: { TOKEN: 'secret' },
    },
  ],
});
const nativeListing: CronListing = {
  ...listing,
  jobs: [{ ...listing.jobs[0]!, nextRunAt: null }],
};

test('native cron observations keep registered IDs, environment and suspended jobs', async () => {
  const observed = await runScoped(
    nibrunnerCronListings(nibrunnerReport({ cron: [nativeListing] })),
  );
  expect(observed).toEqual([listing]);
  expect(await runScoped(nibrunnerCronListings(nibrunnerReport()))).toEqual([]);
});

test('nullable native cron fields are omitted from API responses', async () => {
  const raw = nibrunnerReport({
    cron: [{ ...nativeListing, jobs: [{ ...nativeListing.jobs[0]!, environment: null }] }],
  });
  const original = structuredClone(raw);
  const observed = await runScoped(nibrunnerCronListings(raw));
  expect(JSON.parse(JSON.stringify(observed))).toEqual([
    {
      ...listing,
      jobs: [{ jobId: 'cron-job', schedule: '@daily', command: 'echo task' }],
    },
  ]);
  expect(raw).toEqual(original);
});

test('malformed cron observations fail without exposing registration secrets', async () => {
  const failure = await runScoped(
    Effect.flip(
      nibrunnerCronListings(
        nibrunnerReport({
          cron: [{ ...nativeListing, timeZone: 'tenant-secret' }],
        }),
      ),
    ),
  );
  expect(failure._tag).toBe('ProtocolMismatch');
  expect(failure.message).not.toContain('tenant-secret');
});

test.each([true, false])(
  'cron queries recheck their deployment after the held poll: %s',
  async (stillServed) => {
    await runScoped(
      Effect.gen(function* () {
        const results: unknown[] = [];
        const { baseUrl } = yield* serving(async function control(request) {
          expect(request.headers.get('authorization')).toBe('Bearer token');
          if (new URL(request.url).pathname.endsWith('/cron-query')) {
            expect(await request.json()).toEqual({
              servedDeployments: [{ appId: APP_ID, deploymentId: DEPLOYMENT_ID }],
            });
            return Response.json({ result: 'query', query });
          }
          results.push(Value.Parse(CronQueryResultSchema, await request.json()));
          return Response.json({});
        });
        let reads = 0;
        yield* pollNibrunnerCron({
          control: makeControlPlaneClient({ baseUrl }),
          session,
          listings: Effect.sync(function current() {
            reads += 1;
            return reads === 1 || stillServed ? [listing] : [];
          }),
        });
        expect(results).toEqual([
          {
            queryId: query.queryId,
            outcome: stillServed
              ? { status: 'listed', listing }
              : {
                  status: 'failed',
                  message: 'Cron registrations are not available for this deployment.',
                },
          },
        ]);
      }),
    );
  },
);
