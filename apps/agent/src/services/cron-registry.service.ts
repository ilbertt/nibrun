import type { AppId, CronTable } from '@repo/protocol';
import { Effect, Option, SynchronizedRef } from 'effect';
import { parseCrontab } from '#lib/cron/crontab.ts';
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
      syncDeployments: Effect.fn('CronRegistry.syncDeployments')(
        ({ deployments }: { deployments: readonly CronDeployment[] }) =>
          update((current) => {
            const next = new Map(
              deployments.map((deployment) => {
                const existing = current.get(deployment.appId);
                const table =
                  existing?.deploymentId === deployment.deploymentId
                    ? existing
                    : copyCronTable({ ...deployment, jobs: [] });
                return [deployment.appId, table] as const;
              }),
            );
            const unchanged =
              next.size === current.size &&
              [...next].every(([appId, table]) => current.get(appId) === table);
            return unchanged ? Effect.succeed(current) : persist(next);
          }),
      ),

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

      replaceCrontab: Effect.fn('CronRegistry.replaceCrontab')(
        ({ appId, deploymentId, text }: CronDeployment & { text: string }) =>
          update((current) =>
            Effect.gen(function* () {
              yield* requireCronDeployment({ tables: current, appId, deploymentId });
              const parsed = yield* parseCrontab({ text, after: yield* cronValidationTime });
              const next = new Map(current);
              next.set(appId, copyCronTable({ appId, deploymentId, ...parsed }));
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
