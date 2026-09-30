import type { AppId, CronTable } from '@repo/protocol';
import { Effect, Option, SynchronizedRef } from 'effect';
import {
  type CronDeployment,
  CronRegistryError,
  copyCronTable,
  cronValidationTime,
  readCronRegistry,
  requireCronDeployment,
} from '#lib/cron/registry.ts';
import { validateCronJobs } from '#lib/cron/schedule.ts';
import { writeJsonFile } from '#lib/json-store.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class CronRegistry extends Effect.Service<CronRegistry>()('CronRegistry', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const tables = yield* SynchronizedRef.make(yield* readCronRegistry(config.cronRegistryFile));

    function persist(next: Map<AppId, CronTable>) {
      return writeJsonFile({ path: config.cronRegistryFile, value: [...next.values()] }).pipe(
        Effect.mapError(() => new CronRegistryError({ operation: 'write' })),
        Effect.as(next),
      );
    }

    // Once a replacement reaches disk, interruption must not leave memory holding the old table.
    function update<E, R>(
      change: (current: Map<AppId, CronTable>) => Effect.Effect<Map<AppId, CronTable>, E, R>,
    ) {
      return SynchronizedRef.updateEffect(tables, change).pipe(Effect.uninterruptible);
    }

    return {
      get: ({ appId }: { appId: AppId }) =>
        SynchronizedRef.get(tables).pipe(
          Effect.map((current) =>
            Option.map(Option.fromNullable(current.get(appId)), copyCronTable),
          ),
        ),

      beginDeployment: Effect.fn('CronRegistry.beginDeployment')((deployment: CronDeployment) =>
        update((current) => {
          if (current.get(deployment.appId)?.deploymentId === deployment.deploymentId) {
            return Effect.succeed(current);
          }
          const next = new Map(current);
          next.set(deployment.appId, copyCronTable({ ...deployment, jobs: [] }));
          return persist(next);
        }),
      ),

      replace: Effect.fn('CronRegistry.replace')(
        ({ appId, deploymentId, jobs }: CronDeployment & { jobs: unknown }) =>
          update((current) =>
            Effect.gen(function* () {
              yield* requireCronDeployment({ tables: current, appId, deploymentId });
              const after = yield* cronValidationTime;
              const definitions = yield* validateCronJobs({ jobs, after });
              const next = new Map(current);
              next.set(appId, copyCronTable({ appId, deploymentId, jobs: definitions }));
              return yield* persist(next);
            }),
          ),
      ),

      remove: Effect.fn('CronRegistry.remove')((deployment: CronDeployment) =>
        update((current) =>
          Effect.gen(function* () {
            if (!current.has(deployment.appId)) {
              return current;
            }
            yield* requireCronDeployment({ tables: current, ...deployment });
            const next = new Map(current);
            next.delete(deployment.appId);
            return yield* persist(next);
          }),
        ),
      ),
    };
  }),
  dependencies: [AgentConfig.Default],
}) {}
