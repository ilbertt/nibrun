import type { AppState, DeploymentState, InstanceState } from '@repo/protocol';

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
  // The one thing the release cannot say about itself. An `on-request` app between visitors has a
  // running release and no microVM, and the two are not the same news: the release is serving, and
  // the app is asleep until somebody asks for it.
  | { readonly kind: 'instance'; readonly state: Extract<InstanceState, 'idle'> }
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
    case 'instance':
      return status.state;
    case 'transition':
      return status.label;
    case 'never-deployed':
      return status.kind;
  }
}

const ASLEEP: AppStatus = { kind: 'instance', state: 'idle' };
const SUSPENDED: AppStatus = { kind: 'app', state: 'suspended' };
const SUSPENDING: AppStatus = { kind: 'transition', label: 'suspending' };
const RESUMING: AppStatus = { kind: 'transition', label: 'resuming' };
const NEVER_DEPLOYED: AppStatus = { kind: 'never-deployed' };

/** A release in one of these is not running anything, whatever the app row was asked for. */
const NOT_SERVING: readonly DeploymentState[] = ['stopped', 'failed', 'superseded'];

export function appStatus({
  appState,
  deploymentState,
  instanceState,
}: {
  appState: AppState;
  /** Absent for an app nobody has deployed, which no release can say anything about. */
  deploymentState: DeploymentState | undefined;
  /** Absent for a release no host has reported on, and for one reported by a host that predates it. */
  instanceState?: InstanceState | undefined;
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
  // Read only under a release that is serving, which is the only place it means anything: an app
  // that sleeps between requests has a running release with no microVM behind it, and telling the
  // owner it is running would have them reading a page about an app that is not there.
  if (deploymentState === 'running' && instanceState === 'idle') {
    return ASLEEP;
  }
  // The one state the release holds only because the app was suspended. Asking for the app back
  // is not the host having started it, so this is the gap between the two said out loud.
  return deploymentState === 'stopped' ? RESUMING : { kind: 'deployment', state: deploymentState };
}

/**
 * The one word each status goes by where it is shown to an owner.
 *
 * Written out rather than derived from the key, which is very nearly the same string: `AppStatus`
 * is keyed for switching on and this is read by a person, and the two only agree until a key
 * arrives that a reader would not recognise. Exhaustive for the same reason `STATE` and
 * `LIVE_OUTPUT` are — a status added without a word for it is a type error rather than a surface
 * quietly printing an identifier.
 */
export const APP_STATUS_LABELS: Record<AppStatusKey, string> = {
  'never-deployed': 'never deployed',
  pending: 'pending',
  starting: 'starting',
  running: 'running',
  // Not the key: `idle` is a word for a machine doing nothing, and this is an app doing exactly
  // what its owner configured — waiting to be asked, at no cost, until somebody visits it.
  idle: 'asleep',
  failed: 'failed',
  superseded: 'superseded',
  suspended: 'suspended',
  suspending: 'suspending',
  resuming: 'resuming',
  deleting: 'deleting',
  deleted: 'deleted',
};

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
  // There is no microVM to say anything until a request makes one, and the request that would is
  // the tenant's own traffic rather than somebody opening a log stream.
  idle: false,
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
