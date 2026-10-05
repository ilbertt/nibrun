import { type AppId, CronRunIdSchema, Value } from '@repo/protocol';
import { Cause, Effect, Exit, Option, Scope, SynchronizedRef } from 'effect';
import { registeredCronJobs } from '#lib/cron/jobs.ts';
import type { CronTable } from '#lib/cron/model.ts';
import { cronTimer } from '#lib/cron/timer.ts';
import { CronExecutions } from '#services/cron-executions.service.ts';
import { CronRegistry } from '#services/cron-registry.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';

type ScheduledTable = { readonly table: CronTable; readonly scope: Scope.CloseableScope };

export class CronScheduler extends Effect.Service<CronScheduler>()('CronScheduler', {
  scoped: Effect.gen(function* () {
    const registry = yield* CronRegistry;
    const cache = yield* DesiredStateCache;
    const executions = yield* CronExecutions;
    const runs = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    const scheduled = yield* SynchronizedRef.make(new Map<AppId, ScheduledTable>());

    function launch({
      table,
      entry,
    }: {
      table: CronTable;
      entry: ReturnType<typeof registeredCronJobs>[number];
    }) {
      return Effect.gen(function* () {
        const latest = yield* registry.get({ appId: table.appId });
        if (Option.isNone(latest) || !Bun.deepEquals(latest.value, table)) {
          return;
        }
        const context = {
          ...entry.context,
          cronRunId: yield* Effect.sync(() => Value.Parse(CronRunIdSchema, crypto.randomUUID())),
        };
        yield* executions.execute({ context, job: entry.job }).pipe(
          Effect.catchAllCause((cause) =>
            Cause.isInterruptedOnly(cause)
              ? Effect.void
              : Effect.logWarning('cron execution failed', cause).pipe(
                  Effect.annotateLogs(context),
                ),
          ),
          (effect) => Effect.forkIn(effect, runs),
        );
      });
    }

    function start(table: CronTable) {
      return Effect.gen(function* () {
        const scope = yield* Scope.make();
        for (const entry of registeredCronJobs(table)) {
          yield* Effect.forkIn(
            Effect.scoped(
              Effect.schedule(launch({ table, entry }), cronTimer(entry.job.schedule)),
            ).pipe(
              Effect.catchAllCause((cause) =>
                Cause.isInterruptedOnly(cause)
                  ? Effect.void
                  : Effect.logWarning('cron timer failed', cause).pipe(
                      Effect.annotateLogs(entry.context),
                    ),
              ),
              Effect.interruptible,
            ),
            scope,
          );
        }
        return { table, scope };
      });
    }

    const wanted = Effect.gen(function* () {
      const desired = Option.getOrUndefined(yield* cache.latest);
      const tables = new Map<AppId, CronTable>();
      for (const instance of desired?.instances ?? []) {
        if (instance.desiredState === 'stopped') {
          continue;
        }
        const table = yield* registry.get({ appId: instance.appId });
        if (Option.isSome(table) && table.value.deploymentId === instance.deploymentId) {
          tables.set(instance.appId, table.value);
        }
      }
      return tables;
    });

    const sync = SynchronizedRef.updateEffect(scheduled, (current) =>
      Effect.gen(function* () {
        const tables = yield* wanted;
        const next = new Map<AppId, ScheduledTable>();
        for (const [appId, running] of current) {
          if (Bun.deepEquals(tables.get(appId), running.table)) {
            next.set(appId, running);
          } else {
            yield* Scope.close(running.scope, Exit.void);
          }
        }
        for (const [appId, table] of tables) {
          if (!next.has(appId)) {
            next.set(appId, yield* start(table));
          }
        }
        return next;
      }),
    ).pipe(Effect.uninterruptible);

    yield* Effect.addFinalizer(() =>
      Effect.flatMap(SynchronizedRef.get(scheduled), (current) =>
        Effect.forEach(current.values(), (running) => Scope.close(running.scope, Exit.void), {
          discard: true,
        }),
      ),
    );
    return { sync };
  }),
  dependencies: [CronRegistry.Default, DesiredStateCache.Default, CronExecutions.Default],
}) {}
