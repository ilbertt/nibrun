import { CRON_TIME_ZONE, parseMessage, type Timestamp, TimestampSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Data, Effect } from 'effect';
import { type CronJobDefinitions, CronJobDefinitionsSchema } from '#lib/cron/model.ts';
import { decode } from '#lib/protocol.ts';

export class InvalidCronSchedule extends Data.TaggedError('InvalidCronSchedule')<{
  readonly reason: 'invalid-expression' | 'no-future-occurrence';
}> {
  override get message() {
    return this.reason === 'invalid-expression'
      ? 'The cron schedule is not a valid Bun cron expression.'
      : 'The cron schedule has no future occurrence within the next eight years.';
  }
}

export function nextCronRun({ schedule, after }: { schedule: string; after: Timestamp }) {
  return Effect.try({
    try: () => Bun.cron.parse(schedule, new Date(after), { tz: CRON_TIME_ZONE }),
    catch: () => new InvalidCronSchedule({ reason: 'invalid-expression' }),
  }).pipe(
    Effect.flatMap((next) =>
      next === null
        ? new InvalidCronSchedule({ reason: 'no-future-occurrence' })
        : Effect.succeed(Value.Parse(TimestampSchema, next.toISOString())),
    ),
  );
}

export function validateCronJobs({ jobs, after }: { jobs: unknown; after: Timestamp }) {
  return Effect.gen(function* () {
    const definitions = yield* decode(() =>
      parseMessage({ schema: CronJobDefinitionsSchema, value: jobs }),
    );
    yield* Effect.forEach(
      definitions,
      (definition) => nextCronRun({ schedule: definition.schedule, after }),
      { discard: true },
    );
    return definitions satisfies CronJobDefinitions;
  });
}
