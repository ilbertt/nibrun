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
 * Clock-free — the instant is handed in — and total over every state it holds, which is what
 * lets every path through it be a row in a test rather than a database and a host.
 */
export class DeploymentLifecycle {
  readonly #state: DeploymentState;
  readonly #desiredRunning: boolean;
  readonly #createdAt: Date;
  readonly #stateChangedAt: Date;

  constructor({
    state,
    desiredRunning,
    createdAt,
    stateChangedAt,
  }: {
    state: DeploymentState;
    /** False for a suspended app, whose deployment is not late for anything. */
    desiredRunning: boolean;
    createdAt: Date;
    /**
     * When the app's own state last moved. A release is owed its startup deadline from the moment
     * it was asked to run, and resuming a suspended app asks again — so an app that spent an hour
     * suspended does not come back to a deadline that ran out while nothing was allowed to start.
     */
    stateChangedAt: Date;
  }) {
    this.#state = state;
    this.#desiredRunning = desiredRunning;
    this.#createdAt = createdAt;
    this.#stateChangedAt = stateChangedAt;
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
      case 'stopped':
        return this.#whileStopped(reported);
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
   *
   * The one exception is a stop nobody has to guess at: an owner suspended the app, and the host
   * has confirmed the microVM is down. That is the moment the release stopped serving, and saying
   * so is what lets the owner see the difference between winding down and wound down.
   */
  #whileServing(reported: ReportedInstance | undefined): DeploymentState {
    if (reported?.state === 'failed') {
      return 'failed';
    }
    return this.#stoppedOnPurpose(reported) ? 'stopped' : 'active';
  }

  /**
   * Nothing here is late: a stopped release is one nobody is waiting on. It leaves the moment a
   * host has something to say about a microVM again, which is what a resume looks like from this
   * end — `starting` first, so an owner watching sees it come up rather than blink back to
   * serving before anything answered a probe.
   */
  #whileStopped(reported: ReportedInstance | undefined): DeploymentState {
    switch (reported?.state) {
      case 'running':
        return 'active';
      case 'failed':
        return 'failed';
      case 'pending':
      case 'starting':
        return 'starting';
      default:
        return 'stopped';
    }
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
      // stopped says only that it is not serving, which is what it already said. A release that
      // never served and was then suspended is the exception, and stops rather than waits.
      case 'unhealthy':
      case 'stopping':
      case 'stopped':
        if (this.#stoppedOnPurpose(reported)) {
          return 'stopped';
        }
        return this.#overdue(now) ? 'failed' : this.#state;
    }
  }

  /** The owner asked for it and the host has done it — anything short of both is still in motion. */
  #stoppedOnPurpose(reported: ReportedInstance | undefined): boolean {
    return !this.#desiredRunning && reported?.state === 'stopped';
  }

  #overdue(now: Date): boolean {
    const since = Math.max(this.#createdAt.getTime(), this.#stateChangedAt.getTime());
    return this.#desiredRunning && now.getTime() - since >= STARTUP_DEADLINE_MS;
  }
}
