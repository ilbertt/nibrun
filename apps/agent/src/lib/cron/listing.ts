import { CRON_TIME_ZONE, type CronListing, type CronQuery } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { registeredCronJobs } from '#lib/cron/jobs.ts';
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
    return {
      appId,
      deploymentId,
      enabled: instance.desiredState !== 'stopped',
      timeZone: CRON_TIME_ZONE,
      jobs: registeredCronJobs(table.value).map(({ job, context }) => ({
        ...job,
        jobId: context.cronJobId,
      })),
    } satisfies CronListing;
  });
}
