import type { DeploymentState, InstanceState, ReportedInstance } from '@repo/protocol';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const STARTUP_DEADLINE_MINUTES = 5;

// A host that has not started a deployment yet is not a host that has failed it, so this is how
// long the api waits before calling one that never came up. Long enough to cover a poll, an
// artifact download and a boot; short enough that an owner is told rather than left watching.
export const STARTUP_DEADLINE_MS = STARTUP_DEADLINE_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

const TERMINAL_DEPLOYMENT_STATES: DeploymentState[] = ['superseded', 'failed'];

/**
 * `null` is "the instance says nothing about the release": a microVM that is restarting, waiting
 * on a health check or deliberately stopped is one whose deployment has not changed. Only the
 * first connection the tenant accepts, and the exhaustion of its restart budget, are events in
 * the life of a release rather than of the process running it.
 */
const DEPLOYMENT_STATE_BY_INSTANCE_STATE = {
  pending: 'starting',
  starting: 'starting',
  running: 'active',
  unhealthy: null,
  stopping: null,
  stopped: null,
  failed: 'failed',
} satisfies Record<InstanceState, DeploymentState | null>;

export type DeploymentObservation = {
  current: DeploymentState;
  /** Absent while the host has yet to start it, and for a host that lost the microVM. */
  reported: ReportedInstance | undefined;
  /** False for a suspended app, whose deployment is not late for anything. */
  desiredRunning: boolean;
  ageMs: number;
};

/**
 * What a host reporting this makes of the release, or `null` where it makes nothing of it.
 *
 * Total and clock-free, which is what lets every case below be a row in a test rather than a
 * database and a host. The api reads the clock and hands the age in.
 *
 * An instance missing from a report never fails a deployment that has been `active`: desired
 * state still asks for it, so the host either brings it back and says so or gives up and reports
 * `failed`. Reading absence as failure would instead race every host restart.
 */
export function nextDeploymentState({
  current,
  reported,
  desiredRunning,
  ageMs,
}: DeploymentObservation): DeploymentState | null {
  if (TERMINAL_DEPLOYMENT_STATES.includes(current)) {
    return null;
  }
  const observed = reported ? DEPLOYMENT_STATE_BY_INSTANCE_STATE[reported.state] : undefined;

  // Serving is the one thing a release is for, so once it has served, only running out of
  // restarts ends it — health that comes and goes is the app's, not the deployment's.
  if (current === 'active') {
    return observed === 'failed' ? 'failed' : null;
  }

  const overdue = desiredRunning && ageMs >= STARTUP_DEADLINE_MS;
  const next = observed ?? (overdue ? 'failed' : current);
  return next === current ? null : next;
}
