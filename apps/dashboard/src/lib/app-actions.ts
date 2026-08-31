import { type AppStatus, type AppStatusKey, statusKey } from '@repo/app-operations';

/** Every button on an app's action bar, and so every column of the table below. */
export const APP_ACTIONS = ['deploy', 'export', 'suspend', 'delete'] as const;

export type AppAction = (typeof APP_ACTIONS)[number];

/**
 * `hidden` for an action this status has nothing to do with, `disabled` for one it is on its way
 * back to offering. The difference is what the owner is being told: a button that is gone means
 * the app cannot be asked this, and one that is greyed means it will be asked again. Most greyed
 * buttons say what they are waiting on in their own label; one that cannot carries the sentence
 * saying so as `reason`.
 */
export type AppActionAvailability =
  | { readonly kind: 'enabled' }
  | { readonly kind: 'disabled'; readonly reason?: string }
  | { readonly kind: 'hidden' };

export type AppActions = Record<AppAction, AppActionAvailability>;

/** Also what a deploy with no app behind it gets: no status is holding that one back. */
export const ENABLED: AppActionAvailability = { kind: 'enabled' };

const DISABLED: AppActionAvailability = { kind: 'disabled' };
const HIDDEN: AppActionAvailability = { kind: 'hidden' };

/**
 * A host is only sent releases whose app is asking to run, so one deployed to a suspended app
 * would sit pending until it is resumed rather than fail — an owner watching a spinner for a
 * release nothing is going to start. The way out is the button beside it.
 */
const UNTIL_RESUMED: AppActionAvailability = {
  kind: 'disabled',
  reason: 'This app is suspended, so a new release would never start. Resume it first.',
};

/**
 * Every status against every button, written out rather than derived, because there is no rule
 * underneath: export needs a release to have ever existed, suspend needs one that is running,
 * delete needs the app to not already be going. A status added to `AppStatusKey` is a row missing
 * from here, which is a type error rather than a button someone finds behaving oddly weeks later.
 */
const AVAILABILITY: Record<AppStatusKey, AppActions> = {
  'never-deployed': { deploy: ENABLED, export: HIDDEN, suspend: HIDDEN, delete: ENABLED },
  pending: { deploy: ENABLED, export: ENABLED, suspend: ENABLED, delete: ENABLED },
  starting: { deploy: ENABLED, export: ENABLED, suspend: ENABLED, delete: ENABLED },
  running: { deploy: ENABLED, export: ENABLED, suspend: ENABLED, delete: ENABLED },
  // Everything a running app offers: an app asleep between requests is one that is up as far as
  // its owner is concerned, and suspend is still what takes it offline for good rather than
  // until the next visitor.
  idle: { deploy: ENABLED, export: ENABLED, suspend: ENABLED, delete: ENABLED },
  // Nothing is serving under either of these, so there is nothing to take offline — and a bundle
  // is cut from the volume rather than from a running microVM, so exporting still works.
  failed: { deploy: ENABLED, export: ENABLED, suspend: HIDDEN, delete: ENABLED },
  superseded: { deploy: ENABLED, export: ENABLED, suspend: HIDDEN, delete: ENABLED },
  suspended: { deploy: UNTIL_RESUMED, export: ENABLED, suspend: ENABLED, delete: ENABLED },
  suspending: { deploy: UNTIL_RESUMED, export: ENABLED, suspend: DISABLED, delete: ENABLED },
  // Deploying is offered back the moment the app row asks to run again, which is what resuming is.
  resuming: { deploy: ENABLED, export: ENABLED, suspend: DISABLED, delete: ENABLED },
  // An app on its way out has one thing left to say, and it is the button that says it.
  deleting: { deploy: HIDDEN, export: HIDDEN, suspend: HIDDEN, delete: DISABLED },
  deleted: { deploy: HIDDEN, export: HIDDEN, suspend: HIDDEN, delete: HIDDEN },
};

/** Nothing may be pressed on an app whose status has not been read yet. */
const WHILE_UNREAD: AppActions = {
  deploy: DISABLED,
  export: DISABLED,
  suspend: DISABLED,
  delete: DISABLED,
};

export function appActions(status: AppStatus | undefined): AppActions {
  return status === undefined ? WHILE_UNREAD : AVAILABILITY[statusKey(status)];
}

/** Why a button is greyed, where its own label does not already say. */
export function greyedReason(availability: AppActionAvailability): string | undefined {
  return availability.kind === 'disabled' ? availability.reason : undefined;
}
