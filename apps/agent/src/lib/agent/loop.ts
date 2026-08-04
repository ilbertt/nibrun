import { type Cause, Effect, type Schedule } from 'effect';

/**
 * A loop is the agent's supervision boundary, and the loops run under one `Effect.all`, so a
 * fiber that dies takes its siblings with it. `sandbox` puts defects in the error channel, which
 * is what makes a bug in the export path retry on the same schedule as a refused request rather
 * than stop the host converging instances.
 */
export function supervised<E, R>({
  once,
  onFailure,
  schedule,
}: {
  readonly once: Effect.Effect<unknown, E, R>;
  readonly onFailure: (cause: Cause.Cause<E>) => Effect.Effect<unknown, never, R>;
  readonly schedule: Schedule.Schedule<unknown>;
}) {
  return once.pipe(
    Effect.sandbox,
    Effect.tapError(onFailure),
    Effect.retry(schedule),
    Effect.forever,
  );
}
