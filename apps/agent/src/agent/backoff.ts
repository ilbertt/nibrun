import { Duration, Schedule } from 'effect';

/** Exponential, capped: `union` continues while either does and takes the shorter delay. */
export const CONTROL_PLANE_BACKOFF = Schedule.exponential(Duration.seconds(1), 2).pipe(
  Schedule.union(Schedule.spaced(Duration.seconds(60))),
);
