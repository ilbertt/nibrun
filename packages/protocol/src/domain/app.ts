import { Type } from '@sinclair/typebox';
import { AppIdSchema, OwnerIdSchema } from '#domain/identifiers.ts';
import {
  HealthCheckSchema,
  InstanceResourcesSchema,
  RestartPolicySchema,
} from '#domain/instance.ts';
import { SecretStringSchema } from '#lib/secret.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { DnsLabelSchema, HostnameSchema, HttpPortSchema, TimestampSchema } from '#lib/wire.ts';

/**
 * One name is carved out of what is otherwise the shell's own rule, because a JavaScript object is
 * how an environment travels from here to a host: `environment.__proto__ = value` sets a prototype
 * rather than a property, and a value assigned that way is silently gone. Refusing the name is what
 * turns that into something an owner is told, rather than a variable they set and nobody carries.
 */
const ENVIRONMENT_NAME_PATTERN = '^(?!__proto__$)[A-Za-z_][A-Za-z0-9_]*$';

// An app is always reachable at the hostname nibrun issued it, so every list of them has one.
// Exported because the api narrows this array for its own response and would otherwise restate
// the bound — or, as it did, quietly drop it.
export const MIN_HOSTNAMES = 1;

// Mirrored by CONFIG_MAX_ARGUMENTS in apps/runtime, which refuses a file exceeding it.
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_LENGTH = 4096;

// `platform` is the subdomain nibrun issues; `custom` is a domain the user brought. Modelling
// hostnames as a set from the start is what keeps custom domains a new entry rather than a
// schema change and a rewrite of every routing path.
export const APP_HOSTNAME_KINDS = ['platform', 'custom'] as const;

export const AppHostnameKindSchema = stringEnum(APP_HOSTNAME_KINDS);

export type AppHostnameKind = typeof AppHostnameKindSchema.static;

// Whether the edge can serve the hostname yet. A platform hostname is born `active` — the
// wildcard record and the wildcard certificate already cover it — while a custom one waits for
// the owner to point DNS at us, which is the only proof of ownership there is.
export const APP_HOSTNAME_STATES = ['pending', 'active', 'failed'] as const;

export const AppHostnameStateSchema = stringEnum(APP_HOSTNAME_STATES);

export type AppHostnameState = typeof AppHostnameStateSchema.static;

// No state: a host is sent the hostnames it should be answering for, and one it should not
// answer for yet is left out rather than sent with a flag saying so.
export const AppHostnameSchema = Type.Object({
  hostname: HostnameSchema,
  kind: AppHostnameKindSchema,
});

export type AppHostname = typeof AppHostnameSchema.static;

// Closed, because a name the pattern does not match is otherwise neither validated nor rejected:
// it simply is not part of the record, and parsing drops it. That reads as a variable accepted
// and then silently not set, which is worse than being told the name is not one.
export const TenantEnvironmentSchema = Type.Record(
  Type.String({ pattern: ENVIRONMENT_NAME_PATTERN }),
  SecretStringSchema,
  { additionalProperties: false },
);

export type TenantEnvironment = typeof TenantEnvironmentSchema.static;

/**
 * An edit to an app's environment rather than the whole of one: a variable named is set to what it
 * is given, one given `null` is removed, and one not named is left exactly as it is. That is what
 * lets an owner change one variable without restating values they are not allowed to read back.
 *
 * The one schema here whose values may be `null`, and only ever sent by an owner — a host is told
 * the environment an instance runs with, in full, and never an edit to one.
 */
export const TenantEnvironmentPatchSchema = Type.Record(
  Type.String({ pattern: ENVIRONMENT_NAME_PATTERN }),
  Type.Union([SecretStringSchema, Type.Null()]),
  { additionalProperties: false },
);

export type TenantEnvironmentPatch = typeof TenantEnvironmentPatchSchema.static;

// What the user configured, snapshotted into every deployment so a rollback replays exactly
// what ran rather than whatever the app happens to be configured with now.
// argv[1..] for the tenant binary; argv[0] is always the binary itself. Empty for anything
// built to run bare, which is what `bun build --compile` produces — but a released binary is
// usually a multi-command tool, and one that needs `serve` cannot be started without this.
//
// A list rather than one string: splitting a command line means quoting rules, and the value
// the user typed reaching exec unchanged is worth more than the convenience.
export const TenantArgumentsSchema = Type.Array(Type.String({ maxLength: MAX_ARGUMENT_LENGTH }), {
  maxItems: MAX_ARGUMENTS,
});

export type TenantArguments = typeof TenantArgumentsSchema.static;

export const AppConfigSchema = Type.Object({
  httpPort: HttpPortSchema,
  args: TenantArgumentsSchema,
  environment: TenantEnvironmentSchema,
  resources: InstanceResourcesSchema,
  healthCheck: HealthCheckSchema,
  restartPolicy: RestartPolicySchema,
});

export type AppConfig = typeof AppConfigSchema.static;

export const APP_STATES = ['active', 'suspended', 'deleting', 'deleted'] as const;

export const AppStateSchema = stringEnum(APP_STATES);

export type AppState = typeof AppStateSchema.static;

// The two an owner moves an app between, and the whole of what a request may ask for.
// `deleting` is asked for by deleting the app, and `deleted` is a host's word for a filesystem
// it no longer holds — neither is a state something outside can name.
export const OWNED_APP_STATES = ['active', 'suspended'] as const satisfies readonly AppState[];

export const OwnedAppStateSchema = stringEnum(OWNED_APP_STATES);

export type OwnedAppState = typeof OwnedAppStateSchema.static;

export const AppSchema = Type.Object({
  id: AppIdSchema,
  ownerId: OwnerIdSchema,
  slug: DnsLabelSchema,
  hostnames: Type.Array(AppHostnameSchema, { minItems: MIN_HOSTNAMES }),
  config: AppConfigSchema,
  state: AppStateSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type App = typeof AppSchema.static;
