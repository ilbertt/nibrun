import { CronQuerySchema, Value } from '@repo/protocol';
import { Context, Effect, Layer } from 'effect';
import { CronRegistry } from '#services/cron-registry.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { desiredInstance, desiredState, LOG_SOURCE } from '#tests/support/fixtures.ts';

export const CRON_JOB = { schedule: '*/5 * * * *', command: 'echo hello' };
export const CRON_QUERY = Value.Parse(CronQuerySchema, { ...LOG_SOURCE, queryId: 'query-1' });

export function cronListingHost(directory: string) {
  return Effect.gen(function* () {
    const services = yield* Layer.build(
      Layer.mergeAll(
        CronRegistry.DefaultWithoutDependencies,
        DesiredStateCache.DefaultWithoutDependencies,
      ).pipe(
        Layer.provide(
          agentConfig({
            cronRegistryFile: `${directory}/crons.json`,
            desiredStateFile: `${directory}/desired-state.json`,
          }),
        ),
      ),
    );
    const registry = Context.get(services, CronRegistry);
    const cache = Context.get(services, DesiredStateCache);
    yield* cache.restore;
    const layer = Layer.mergeAll(
      Layer.succeed(CronRegistry, registry),
      Layer.succeed(DesiredStateCache, cache),
    );
    return { registry, cache, layer };
  });
}

export function registeredCronHost(directory: string) {
  return Effect.gen(function* () {
    const host = yield* cronListingHost(directory);
    yield* host.cache.accept(desiredState({ instances: [desiredInstance()] }));
    yield* host.registry.beginDeployment(LOG_SOURCE);
    yield* host.registry.replace({ ...LOG_SOURCE, jobs: [CRON_JOB] });
    return host;
  });
}
