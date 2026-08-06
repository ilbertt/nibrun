import type { DeploymentState, ReportedInstance } from '@repo/protocol';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const STARTUP_DEADLINE_MINUTES = 5;

// A host that has not started a deployment yet is not a host that has failed it, so this is how
// long the api waits before calling one that never came up. Long enough to cover a poll, an
// artifact download and a boot; short enough that an owner is told rather than left watching.
export const STARTUP_DEADLINE_MS = STARTUP_DEADLINE_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * Where one release is in its life, and what a host reporting on it moves it to.
 *
 * Clock-free — the instant is handed in — and total over both states it holds, which is what
 * lets every path through it be a row in a test rather than a database and a host.
 */
export class DeploymentLifecycle {
  readonly #state: DeploymentState;
  readonly #desiredRunning: boolean;
  readonly #createdAt: Date;

  constructor({
    state,
    desiredRunning,
    createdAt,
  }: {
    state: DeploymentState;
    /** False for a suspended app, whose deployment is not late for anything. */
    desiredRunning: boolean;
    createdAt: Date;
  }) {
    this.#state = state;
    this.#desiredRunning = desiredRunning;
    this.#createdAt = createdAt;
  }

  /** `reported` is absent while a host has yet to start the microVM, and for one that lost it. */
  advanceState({
    reported,
    now,
  }: {
    reported: ReportedInstance | undefined;
    now: Date;
  }): DeploymentState {
    switch (this.#state) {
      // A report assembled before a redeploy landed still names the row that redeploy
      // superseded, so this is what stops one reopening a release that is over.
      case 'superseded':
      case 'failed':
        return this.#state;
      case 'active':
        return this.#whileServing(reported);
      case 'pending':
      case 'starting':
        return this.#whileComingUp({ reported, now });
    }
  }

  /**
   * Serving is the one thing a release is for, so once it has served only running out of
   * restarts ends it. Health that comes and goes belongs to the app rather than to the release:
   * a deployment state for it would churn the index keeping one live per app every time a probe
   * missed, and an instance absent from a report is news a host has yet to send rather than a
   * failure — desired state still asks for it, so the host brings it back or says it could not.
   */
  #whileServing(reported: ReportedInstance | undefined): DeploymentState {
    return reported?.state === 'failed' ? 'failed' : 'active';
  }

  #whileComingUp({
    reported,
    now,
  }: {
    reported: ReportedInstance | undefined;
    now: Date;
  }): DeploymentState {
    if (!reported) {
      return this.#overdue(now) ? 'failed' : this.#state;
    }
    switch (reported.state) {
      case 'pending':
      case 'starting':
        return 'starting';
      case 'running':
        return 'active';
      case 'failed':
        return 'failed';
      // Nothing about the release: a microVM restarting, waiting on a probe or deliberately
      // stopped says only that it is not serving, which is what it already said.
      case 'unhealthy':
      case 'stopping':
      case 'stopped':
        return this.#overdue(now) ? 'failed' : this.#state;
    }
  }

  #overdue(now: Date): boolean {
    return this.#desiredRunning && now.getTime() - this.#createdAt.getTime() >= STARTUP_DEADLINE_MS;
  }
}
