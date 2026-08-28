import type { SettledDeployment } from '#deploy.ts';
import { type AppStatus, type AppStatusKey, statusKey } from '#status.ts';

/**
 * Everything an owner asks of an app that its state has an opinion about — not one per command:
 * `nib run` and `nib apps update` both make a release, and a state that will not take one will not
 * take either.
 */
export const APP_OPERATIONS = [
  'release',
  'logs',
  'files',
  'export',
  'suspend',
  'resume',
  'delete',
  'domains',
] as const;

export type AppOperation = (typeof APP_OPERATIONS)[number];

type AppState = {
  /** What the app is, which is the middle of every sentence refusing on account of it. */
  readonly because: string;
  /** The way out, where the state has one. */
  readonly hint?: string;
  readonly refuses: readonly AppOperation[];
};

/**
 * Every state an app can be in against what it will not do in that state, written out rather than
 * derived, because there is no rule underneath: a bundle is cut from the volume and so survives a
 * release that failed, while a directory is read inside the microVM and so does not.
 *
 * A state added to `AppStatusKey` is a row missing from here, which is a type error rather than a
 * command someone finds hanging on an app that was never going to answer it.
 */
const STATE: Record<AppStatusKey, AppState> = {
  'never-deployed': { because: 'has never been deployed', refuses: ['logs', 'files', 'export'] },
  pending: { because: 'is staging a release', refuses: [] },
  starting: { because: 'is starting', refuses: [] },
  running: { because: 'is running', refuses: [] },
  // The volume outlives the release that failed on it, so everything but reading it from inside
  // a microVM still works — including the export that is how you get at it instead.
  failed: { because: 'is on a release that failed', refuses: ['files'] },
  superseded: { because: 'is on a release that was replaced', refuses: ['files'] },
  suspended: { because: 'is suspended', hint: 'Resume it first.', refuses: ['release', 'files'] },
  // Refused a moment early on purpose: the microVM has not stopped yet, and offering a browse for
  // the seconds it has left is worse than saying the app is suspended before it quite is.
  suspending: {
    because: 'is suspending',
    hint: 'Resume it once it has stopped.',
    refuses: ['release', 'files'],
  },
  resuming: { because: 'is resuming', refuses: [] },
  // Its output is the exception: what an app wrote is worth reading right up to the moment it
  // goes, and reading it asks nothing of the host that is tearing the app down.
  deleting: {
    because: 'is being deleted',
    refuses: ['release', 'files', 'export', 'suspend', 'resume', 'domains'],
  },
  deleted: { because: 'has been deleted', refuses: [...APP_OPERATIONS] },
};

/** What the operation cannot do about it, which is the end of that same sentence. */
const CANNOT: Record<AppOperation, string> = {
  release: 'a new release would never start',
  logs: 'there is no output to read',
  files: 'nothing is mounting its filesystem to read',
  export: 'there is nothing to bundle',
  suspend: 'there is nothing left to take offline',
  resume: 'there is nothing left to bring back',
  delete: 'there is nothing left to delete',
  domains: 'its hostnames are going with it',
};

/**
 * Why the app's state says no, in the one sentence that says it, or nothing at all where it does
 * not — which is what every command asks before it sends anything or waits on anything.
 */
export function operationRefusal({
  status,
  operation,
  slug,
  release,
}: {
  status: AppStatus;
  operation: AppOperation;
  slug: string;
  /** The release the app is on, which for one that never came up kept the host's account of why. */
  release?: SettledDeployment | undefined;
}): string | undefined {
  const state = STATE[statusKey(status)];
  if (!state.refuses.includes(operation)) {
    return undefined;
  }
  const refusal = `App ${slug} ${state.because}, so ${CANNOT[operation]}`;
  if (state.hint !== undefined) {
    return `${refusal}. ${state.hint}`;
  }
  // A release that did not come up kept the host's account of why, which says more than the state
  // does — set off rather than sentenced, because the words are the host's and start where it
  // started them.
  const said = statusKey(status) === 'failed' ? release?.message : undefined;
  return said === undefined ? `${refusal}.` : `${refusal} — ${said}`;
}
