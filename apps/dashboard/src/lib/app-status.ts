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
export type AppStatus =
  | { readonly kind: 'app'; readonly state: AppState }
  | { readonly kind: 'deployment'; readonly state: DeploymentState }
  | { readonly kind: 'transition'; readonly label: 'suspending' | 'resuming' }
  | { readonly kind: 'never-deployed' };

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

/** Whether this is a state something else is still moving out of, and so worth asking again. */
export function isSettling(status: AppStatus): boolean {
  if (status.kind === 'transition') {
    return true;
  }
  return (
    status.kind === 'deployment' && (status.state === 'pending' || status.state === 'starting')
  );
}
