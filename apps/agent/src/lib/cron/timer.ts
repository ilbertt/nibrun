import { Duration, Effect, Schedule } from 'effect';
import { nowTimestamp, toEpochMs } from '#lib/clock.ts';
import { nextCronRun } from '#lib/cron/schedule.ts';

export function cronTimer(schedule: string) {
  return Schedule.forever.pipe(
    Schedule.addDelayEffect(() =>
      Effect.gen(function* () {
        const after = yield* nowTimestamp;
        const next = yield* nextCronRun({ schedule, after });
        return Duration.millis(toEpochMs(next) - toEpochMs(after));
      }).pipe(Effect.orDie),
    ),
  );
}
