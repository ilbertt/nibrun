import { Effect, Schedule } from 'effect';
import { supervised } from '#lib/agent/loop.ts';
import { CronRegistry } from '#services/cron-registry.service.ts';
import { CronScheduler } from '#services/cron-scheduler.service.ts';

const REGISTRY_REFRESH_INTERVAL = '1 second';

export const cronLoop = Effect.gen(function* () {
  const scheduler = yield* CronScheduler;
  const registry = yield* CronRegistry;
  yield* supervised({
    once: scheduler.sync.pipe(
      Effect.andThen(Effect.race(registry.changed, Effect.sleep(REGISTRY_REFRESH_INTERVAL))),
    ),
    onFailure: (cause) => Effect.logWarning('cron registry synchronization failed', cause),
    schedule: Schedule.spaced(REGISTRY_REFRESH_INTERVAL),
  });
});
