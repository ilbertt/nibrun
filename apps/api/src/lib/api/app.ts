import {
  AppConfigSchema,
  AppHostnameSchema,
  AppIdSchema,
  type Brand,
  type BrandedSchema,
  IdleTimeoutMsSchema,
  TimestampSchema,
} from '@repo/protocol';
import { stringEnum } from '@repo/typebox-extensions';
import { type TString, Type } from '@sinclair/typebox';
import { DnsLabelSchema } from '#lib/api/dns-label.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';

// An app is always reachable at the hostname nibrun issued it, so every list of them has one.
// Exported because the api narrows this array for its own response and would otherwise restate
// the bound — or, as it did, quietly drop it.
export const MIN_HOSTNAMES = 1;

// Whether the edge can serve the hostname yet. A platform hostname is born `active` — the
// wildcard record and the wildcard certificate already cover it — while a custom one waits for
// the owner to point DNS at us, which is the only proof of ownership there is.
export const APP_HOSTNAME_STATES = ['pending', 'active', 'failed'] as const;
export const AppHostnameStateSchema = stringEnum(APP_HOSTNAME_STATES);
export type AppHostnameState = typeof AppHostnameStateSchema.static;

// Whether the app's microVM is kept up or is brought up by a request for it. `on-request` is what
// a new app gets: an app nobody is visiting holds no memory, and the visitor who ends a quiet
// spell waits for a restore rather than for a boot.
//
// `always` is the answer to the two things a request cannot stand in for. A connection that is the
// first one to a stopped app cannot be carried across the wake, so a websocket is asked to
// reconnect; and only requests reaching the app count as activity, so one that does nothing but
// outbound work reads as quiet and is stopped.
//
// A property of the app rather than of a release, and so on `apps` beside `state` rather than on
// the config a deployment pins: it is the same kind of fact as being suspended — how the app is
// brought up, not what it runs — and a rollback replaying an activation policy from months ago
// would be the wrong thing every time.
export const APP_ACTIVATIONS = ['always', 'on-request'] as const;
export const AppActivationSchema = stringEnum(APP_ACTIVATIONS);
export type AppActivation = typeof AppActivationSchema.static;
export const APP_STATES = ['active', 'suspended', 'deleting', 'deleted'] as const;
export const AppStateSchema = stringEnum(APP_STATES);
export type AppState = typeof AppStateSchema.static;

// The two an owner moves an app between, and the whole of what a request may ask for.
// `deleting` is asked for by deleting the app, and `deleted` is a host's word for a filesystem
// it no longer holds — neither is a state something outside can name.
export const OWNED_APP_STATES = ['active', 'suspended'] as const satisfies readonly AppState[];
export const OwnedAppStateSchema = stringEnum(OWNED_APP_STATES);
export type OwnedAppState = typeof OwnedAppStateSchema.static;
const MAX_APP_NAME_LENGTH = 128;
export type AppName = Brand<string, 'AppName'>;

/**
 * What an owner calls the app, and what they name it by everywhere they are asked for one. Unique
 * among the apps they still have, so it can stand for the app the way the slug does — the slug is
 * what it is served under, minted from the first name once and kept through every rename.
 */
export const AppNameSchema = Type.String({
  minLength: 1,
  maxLength: MAX_APP_NAME_LENGTH,
}) as BrandedSchema<TString, AppName>;

export const AppSchema = Type.Object({
  id: AppIdSchema,
  ownerId: OwnerIdSchema,
  name: AppNameSchema,
  slug: DnsLabelSchema,
  hostnames: Type.Array(AppHostnameSchema, { minItems: MIN_HOSTNAMES }),
  config: AppConfigSchema,
  state: AppStateSchema,
  activation: AppActivationSchema,
  // Carried on every app rather than only on the ones it is read for, so that how an app comes up
  // is one field and not two — and so an app moved off `on-request` and back keeps the timeout it
  // was given rather than the default.
  idleTimeoutMs: IdleTimeoutMsSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type App = typeof AppSchema.static;
