import { CRON_TIME_ZONE, type CronListing, type CronQuery } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { nowTimestamp } from '#lib/clock.ts';
import { registeredCronJobs } from '#lib/cron/jobs.ts';
import { nextCronRun } from '#lib/cron/schedule.ts';
import { CronRegistry } from '#services/cron-registry.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';

export class CronListingUnavailable extends Data.TaggedError('CronListingUnavailable') {
  override get message() {
    return 'Cron registrations are not available for this deployment.';
  }
}

export function readCronListing({
  appId,
  deploymentId,
}: Pick<CronQuery, 'appId' | 'deploymentId'>) {
  return Effect.gen(function* () {
    const registry = yield* CronRegistry;
    const cache = yield* DesiredStateCache;
    const desired = Option.getOrUndefined(yield* cache.latest);
    const instance = desired?.instances.find(
      (candidate) => candidate.appId === appId && candidate.deploymentId === deploymentId,
    );
    const table = yield* registry.get({ appId });
    if (!instance || Option.isNone(table) || table.value.deploymentId !== deploymentId) {
      return yield* new CronListingUnavailable();
    }
    const enabled = instance.desiredState !== 'stopped';
    const after = yield* nowTimestamp;
    const jobs = yield* Effect.forEach(registeredCronJobs(table.value), ({ job, context }) =>
      Effect.gen(function* () {
        const nextRunAt = enabled
          ? yield* nextCronRun({ schedule: job.schedule, after }).pipe(
              Effect.catchTag('InvalidCronSchedule', () => Effect.succeed(undefined)),
            )
          : undefined;
        return {
          ...job,
          jobId: context.cronJobId,
          ...(nextRunAt === undefined ? {} : { nextRunAt }),
        };
      }),
    );
    return {
      appId,
      deploymentId,
      enabled,
      timeZone: CRON_TIME_ZONE,
      jobs,
    } satisfies CronListing;
  });
}
