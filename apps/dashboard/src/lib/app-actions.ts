import { type AppStatus, type AppStatusKey, statusKey } from '#lib/app-status.ts';

/** Every button on an app's action bar, and so every column of the table below. */
export const APP_ACTIONS = ['deploy', 'export', 'suspend', 'delete'] as const;

export type AppAction = (typeof APP_ACTIONS)[number];

/**
 * `hidden` for an action this status has nothing to do with, `disabled` for one it is on its way
 * back to offering. The difference is what the owner is being told: a button that is gone means
 * the app cannot be asked this, and one that is greyed means it is already being asked something
 * — which is why every greyed button here says what it is waiting on.
 */
export type AppActionAvailability = 'enabled' | 'disabled' | 'hidden';

export type AppActions = Record<AppAction, AppActionAvailability>;

/**
 * Every status against every button, written out rather than derived, because there is no rule
 * underneath: export needs a release to have ever existed, suspend needs one that is running,
 * delete needs the app to not already be going. A status added to `AppStatusKey` is a row missing
 * from here, which is a type error rather than a button someone finds behaving oddly weeks later.
 */
const AVAILABILITY: Record<AppStatusKey, AppActions> = {
  'never-deployed': { deploy: 'enabled', export: 'hidden', suspend: 'hidden', delete: 'enabled' },
  pending: { deploy: 'enabled', export: 'enabled', suspend: 'enabled', delete: 'enabled' },
  starting: { deploy: 'enabled', export: 'enabled', suspend: 'enabled', delete: 'enabled' },
  active: { deploy: 'enabled', export: 'enabled', suspend: 'enabled', delete: 'enabled' },
  // Nothing is serving under either of these, so there is nothing to take offline — and a bundle
  // is cut from the volume rather than from a running microVM, so exporting still works.
  failed: { deploy: 'enabled', export: 'enabled', suspend: 'hidden', delete: 'enabled' },
  superseded: { deploy: 'enabled', export: 'enabled', suspend: 'hidden', delete: 'enabled' },
  suspended: { deploy: 'enabled', export: 'enabled', suspend: 'enabled', delete: 'enabled' },
  suspending: { deploy: 'enabled', export: 'enabled', suspend: 'disabled', delete: 'enabled' },
  resuming: { deploy: 'enabled', export: 'enabled', suspend: 'disabled', delete: 'enabled' },
  // An app on its way out has one thing left to say, and it is the button that says it.
  deleting: { deploy: 'hidden', export: 'hidden', suspend: 'hidden', delete: 'disabled' },
  deleted: { deploy: 'hidden', export: 'hidden', suspend: 'hidden', delete: 'hidden' },
};

/** Nothing may be pressed on an app whose status has not been read yet. */
const WHILE_UNREAD: AppActions = {
  deploy: 'disabled',
  export: 'disabled',
  suspend: 'disabled',
  delete: 'disabled',
};

export function appActions(status: AppStatus | undefined): AppActions {
  return status === undefined ? WHILE_UNREAD : AVAILABILITY[statusKey(status)];
}
