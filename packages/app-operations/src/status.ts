import type { AppState, DeploymentState } from '@repo/protocol';

/**
 * What an app is doing, from the two things that know: the app row, which is what its owner asked
 * for and moves the instant they ask, and the release, which is what a host has actually done
 * about it.
 *
 * They disagree for as long as a microVM takes to wind down or boot, and that disagreement is the
 * whole point of this — an app is not suspended because someone pressed suspend, it is suspended
 * once the thing serving it has stopped.
 */
/** The two moments the app row and the release disagree, named for what is happening. */
export type AppTransition = 'suspending' | 'resuming';

export type AppStatus =
  // Never `active`: an app row is active from the moment it is created, so on its own it says
  // nothing about what is serving, and the release answers instead.
  | { readonly kind: 'app'; readonly state: Exclude<AppState, 'active'> }
  // Never `stopped`: a release is only ever stopped because its app was suspended, which is the
  // suspended app above or one of the two transitions below.
  | { readonly kind: 'deployment'; readonly state: Exclude<DeploymentState, 'stopped'> }
  | { readonly kind: 'transition'; readonly label: AppTransition }
  | { readonly kind: 'never-deployed' };

type Named<Status extends AppStatus> = Status extends { readonly label: AppTransition }
  ? Status['label']
  : Status extends { readonly state: string }
    ? Status['state']
    : Status['kind'];

/** The one word a status goes by, and so what a table of every status is keyed by. */
export type AppStatusKey = Named<AppStatus>;

export function statusKey(status: AppStatus): AppStatusKey {
  switch (status.kind) {
    case 'app':
    case 'deployment':
      return status.state;
    case 'transition':
      return status.label;
    case 'never-deployed':
      return status.kind;
  }
}

const SUSPENDED: AppStatus = { kind: 'app', state: 'suspended' };
const SUSPENDING: AppStatus = { kind: 'transition', label: 'suspending' };
const RESUMING: AppStatus = { kind: 'transition', label: 'resuming' };
const NEVER_DEPLOYED: AppStatus = { kind: 'never-deployed' };

/** A release in one of these is not running anything, whatever the app row was asked for. */
const NOT_SERVING: readonly DeploymentState[] = ['stopped', 'failed', 'superseded'];

export function appStatus({
  appState,
  deploymentState,
}: {
  appState: AppState;
  /** Absent for an app nobody has deployed, which no release can say anything about. */
  deploymentState: DeploymentState | undefined;
}): AppStatus {
  if (appState === 'deleting' || appState === 'deleted') {
    return { kind: 'app', state: appState };
  }
  if (appState === 'suspended') {
    return deploymentState === undefined || NOT_SERVING.includes(deploymentState)
      ? SUSPENDED
      : SUSPENDING;
  }
  if (deploymentState === undefined) {
    return NEVER_DEPLOYED;
  }
  // The one state the release holds only because the app was suspended. Asking for the app back
  // is not the host having started it, so this is the gap between the two said out loud.
  return deploymentState === 'stopped' ? RESUMING : { kind: 'deployment', state: deploymentState };
}

/**
 * Whether a microVM is up to write anything. A stream tailing an app in any other state is
 * connected to something that will never say a word, which is not what live means.
 */
const LIVE_OUTPUT: Record<AppStatusKey, boolean> = {
  'never-deployed': false,
  // Staged rather than started: there is no microVM until a host has made one.
  pending: false,
  starting: true,
  running: true,
  failed: false,
  superseded: false,
  suspended: false,
  // One is still up until the host says otherwise and the other is on its way back, so both are
  // states output can still arrive in.
  suspending: true,
  resuming: true,
  deleting: false,
  deleted: false,
};

export function hasLiveOutput(status: AppStatus): boolean {
  return LIVE_OUTPUT[statusKey(status)];
}

/** Whether this is a state something else is still moving out of, and so worth asking again. */
export function isSettling(status: AppStatus): boolean {
  if (status.kind === 'transition') {
    return true;
  }
  return (
    status.kind === 'deployment' && (status.state === 'pending' || status.state === 'starting')
  );
}
