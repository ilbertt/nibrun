import { Effect, Schedule } from 'effect';
import { supervised } from '#lib/agent/loop.ts';
import { CronRegistry } from '#services/cron-registry.service.ts';
import { CronScheduler } from '#services/cron-scheduler.service.ts';

const REGISTRY_RETRY_INTERVAL = '1 second';

export const cronLoop = Effect.gen(function* () {
  const scheduler = yield* CronScheduler;
  const registry = yield* CronRegistry;
  yield* supervised({
    once: scheduler.sync.pipe(Effect.andThen(registry.changed)),
    onFailure: (cause) => Effect.logWarning('cron registry synchronization failed', cause),
    schedule: Schedule.spaced(REGISTRY_RETRY_INTERVAL),
  });
});
