import { Duration, Schedule } from 'effect';

/**
 * Exponential, capped: `union` continues while either does and takes the shorter delay. Jittered
 * because every host in the fleet backs off against the same control plane, and a fleet retrying
 * in lockstep re-floods it the moment it recovers.
 */
export const CONTROL_PLANE_BACKOFF = Schedule.exponential(Duration.seconds(1), 2).pipe(
  Schedule.union(Schedule.spaced(Duration.seconds(60))),
  Schedule.jittered,
);
