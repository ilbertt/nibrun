import { describe, expect, test } from 'bun:test';
import { CronListingSchema, DeploymentIdSchema, isValidMessage, Value } from '@repo/protocol';
import { Effect, Either } from 'effect';
import { registeredCronJobs } from '#lib/cron/jobs.ts';
import { readCronListing } from '#lib/cron/listing.ts';
import { CRON_JOB, cronListingHost, registeredCronHost } from '#tests/support/crons.ts';
import { desiredInstance, desiredState, LOG_SOURCE } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const NEXT_DEPLOYMENT = { ...LOG_SOURCE, deploymentId: Value.Parse(DeploymentIdSchema, 'dep-2') };

describe('live cron listings from the registry', () => {
  test('job identities match execution, including duplicate definitions', () =>
    run(
      Effect.gen(function* () {
        const host = yield* registeredCronHost(yield* temporaryDirectory);
        const jobs = [CRON_JOB, CRON_JOB];
        yield* host.registry.replace({ ...LOG_SOURCE, jobs });
        const listing = yield* readCronListing(LOG_SOURCE).pipe(Effect.provide(host.layer));
        expect(isValidMessage({ schema: CronListingSchema, value: listing })).toBe(true);
        expect(listing.jobs.map((job) => job.jobId)).toEqual(
          registeredCronJobs({ ...LOG_SOURCE, jobs }).map((entry) => entry.context.cronJobId),
        );
        expect(listing.jobs[0]?.jobId).not.toBe(listing.jobs[1]?.jobId);
      }),
    ));

  test('suspension changes status without removing registrations or requiring a guest', () =>
    run(
      Effect.gen(function* () {
        const host = yield* registeredCronHost(yield* temporaryDirectory);
        const before = yield* readCronListing(LOG_SOURCE).pipe(Effect.provide(host.layer));
        yield* host.cache.accept(
          desiredState({ instances: [desiredInstance({ desiredState: 'stopped' })] }),
        );
        const suspended = yield* readCronListing(LOG_SOURCE).pipe(Effect.provide(host.layer));
        expect(suspended.enabled).toBe(false);
        expect(suspended.jobs).toEqual(before.jobs);
        yield* host.cache.accept(desiredState({ instances: [desiredInstance()] }));
        expect((yield* readCronListing(LOG_SOURCE).pipe(Effect.provide(host.layer))).enabled).toBe(
          true,
        );
      }),
    ));

  test('a redeploy cannot return the previous deployment registrations', () =>
    run(
      Effect.gen(function* () {
        const host = yield* registeredCronHost(yield* temporaryDirectory);
        const next = desiredState({
          instances: [desiredInstance({ deploymentId: NEXT_DEPLOYMENT.deploymentId })],
        });
        yield* host.cache.accept(next);
        expect(
          Either.isLeft(
            yield* Effect.either(readCronListing(LOG_SOURCE).pipe(Effect.provide(host.layer))),
          ),
        ).toBe(true);
        expect(
          Either.isLeft(
            yield* Effect.either(readCronListing(NEXT_DEPLOYMENT).pipe(Effect.provide(host.layer))),
          ),
        ).toBe(true);
        yield* host.registry.syncDeployments({ deployments: next.instances });
        const listing = yield* readCronListing(NEXT_DEPLOYMENT).pipe(Effect.provide(host.layer));
        expect(listing.jobs).toEqual([]);
        expect(listing.deploymentId).toBe(NEXT_DEPLOYMENT.deploymentId);
      }),
    ));

  test('a removed deployment is unavailable even before registry cleanup', () =>
    run(
      Effect.gen(function* () {
        const host = yield* registeredCronHost(yield* temporaryDirectory);
        yield* host.cache.accept(desiredState());
        const result = yield* Effect.either(
          readCronListing(LOG_SOURCE).pipe(Effect.provide(host.layer)),
        );
        expect(Either.isLeft(result) && result.left._tag).toBe('CronListingUnavailable');
      }),
    ));

  test('an agent restart restores the listing, job IDs, and suspension status', () =>
    run(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectory;
        const host = yield* registeredCronHost(directory);
        yield* host.cache.accept(
          desiredState({ instances: [desiredInstance({ desiredState: 'stopped' })] }),
        );
        const before = yield* readCronListing(LOG_SOURCE).pipe(Effect.provide(host.layer));
        const restarted = yield* cronListingHost(directory);
        const restored = yield* readCronListing(LOG_SOURCE).pipe(Effect.provide(restarted.layer));
        expect(restored).toEqual(before);
        expect(restored.enabled).toBe(false);
      }),
    ));
});
