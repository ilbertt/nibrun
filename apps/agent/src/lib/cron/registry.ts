import {
  type AppId,
  type CronTable,
  CronTablesSchema,
  parseMessage,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { Clock, Data, Effect, Option } from 'effect';
import { validateCronJobs } from '#lib/cron/schedule.ts';
import { readJsonFile } from '#lib/json-store.ts';
import { decode } from '#lib/protocol.ts';

export type CronDeployment = Pick<CronTable, 'appId' | 'deploymentId'>;

export class CronDeploymentMismatch extends Data.TaggedError('CronDeploymentMismatch') {
  override get message() {
    return 'Cron registrations must belong to the current deployment.';
  }
}

export class CronRegistryError extends Data.TaggedError('CronRegistryError')<{
  readonly operation: 'read' | 'write' | 'restore';
}> {
  override get message() {
    return `The agent could not ${this.operation} its cron registry.`;
  }
}

export function copyCronTable(table: CronTable): CronTable {
  return {
    appId: table.appId,
    deploymentId: table.deploymentId,
    jobs: table.jobs.map(({ schedule, command }) => ({ schedule, command })),
  };
}

export function requireCronDeployment({
  tables,
  appId,
  deploymentId,
}: CronDeployment & { tables: ReadonlyMap<AppId, CronTable> }) {
  return tables.get(appId)?.deploymentId === deploymentId
    ? Effect.void
    : Effect.fail(new CronDeploymentMismatch());
}

export const cronValidationTime = Clock.currentTimeMillis.pipe(
  Effect.map((now) => Value.Parse(TimestampSchema, new Date(now).toISOString())),
);

export function readCronRegistry(path: string) {
  return Effect.gen(function* () {
    const stored = yield* readJsonFile(path).pipe(
      Effect.mapError(() => new CronRegistryError({ operation: 'read' })),
    );
    const tables = new Map<AppId, CronTable>();
    if (Option.isNone(stored)) {
      return tables;
    }
    const records = yield* decode(() =>
      parseMessage({ schema: CronTablesSchema, value: stored.value }),
    ).pipe(Effect.mapError(() => new CronRegistryError({ operation: 'restore' })));
    const after = yield* cronValidationTime;
    for (const table of records) {
      if (tables.has(table.appId)) {
        return yield* new CronRegistryError({ operation: 'restore' });
      }
      yield* validateCronJobs({ jobs: table.jobs, after }).pipe(
        Effect.mapError(() => new CronRegistryError({ operation: 'restore' })),
      );
      tables.set(table.appId, copyCronTable(table));
    }
    return tables;
  });
}
