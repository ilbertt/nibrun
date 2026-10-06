import { Type } from '@sinclair/typebox';
import { RUNTIME_VALUE_NAMES, RUNTIME_VALUE_PREFIX } from '#lib/runtime-values.ts';
import { secretString } from '#lib/secret.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { HostnameSchema, HttpPortSchema } from '#lib/wire.ts';
import {
  HealthCheckSchema,
  InstanceResourcesSchema,
  RestartPolicySchema,
} from '#schemas/instance.ts';

/**
 * One name is carved out of what is otherwise the shell's own rule, because a JavaScript object is
 * how an environment travels from here to a host: `environment.__proto__ = value` sets a prototype
 * rather than a property, and a value assigned that way is silently gone. Refusing the name is what
 * turns that into something an owner is told, rather than a variable they set and nobody carries.
 */
const ENVIRONMENT_NAME_PATTERN = '^(?!__proto__$)[A-Za-z_][A-Za-z0-9_]*$';
const OFFERED_RUNTIME_VALUES = RUNTIME_VALUE_NAMES.join('|');
const NAME_CHARACTER = '[A-Za-z0-9_]';

// Complete unknown references fail in the guest; bare names and unmatched braces stay literal.
const TENANT_VALUE_PATTERN = [
  '^(?:',
  '[^$]',
  `|\\$(?!\\{${RUNTIME_VALUE_PREFIX}${NAME_CHARACTER}*\\})`,
  `|\\$\\{(?:${OFFERED_RUNTIME_VALUES})\\}`,
  ')*$',
].join('');
const TenantValueSchema = secretString({ pattern: TENANT_VALUE_PATTERN });

// Mirrored by CONFIG_MAX_ARGUMENTS in apps/runtime, which refuses a file exceeding it.
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_LENGTH = 4096;

// `platform` is the subdomain nibrun issues; `custom` is a domain the user brought. Modelling
// hostnames as a set from the start is what keeps custom domains a new entry rather than a
// schema change and a rewrite of every routing path.
export const APP_HOSTNAME_KINDS = ['platform', 'custom'] as const;
export const AppHostnameKindSchema = stringEnum(APP_HOSTNAME_KINDS);
export type AppHostnameKind = typeof AppHostnameKindSchema.static;

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
  TenantValueSchema,
  { additionalProperties: false },
);

export type TenantEnvironment = typeof TenantEnvironmentSchema.static;

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
  // Whether the app is reached on a public TCP and UDP port besides HTTP. A yes or no rather than
  // a number, because the port has to be the same on every hop for a binary that announces the one
  // it bound to be announcing a reachable one — which makes choosing it the host's, and the guest
  // is told which it got.
  hasExtraPublicPort: Type.Boolean(),
  args: TenantArgumentsSchema,
  environment: TenantEnvironmentSchema,
  resources: InstanceResourcesSchema,
  healthCheck: HealthCheckSchema,
  restartPolicy: RestartPolicySchema,
});

export type AppConfig = typeof AppConfigSchema.static;

/**
 * How long an `on-request` app goes unasked-for before its microVM is stopped.
 *
 * The whole of what scale-to-zero saves is memory a sleeping app is not holding, so this is the
 * dial the saving is on: an app visited three times a day sleeps for most of it at fifteen
 * minutes and for almost none of it at an hour. What it costs is a cold boot for whoever arrives
 * after the gap, which is why it is not seconds.
 *
 * The floor is the cadence the decision is made on rather than a round number: whether an app has
 * gone quiet is only asked when its traffic is measured, so a shorter timeout than that would be
 * one the host accepts and cannot keep.
 *
 * Beside the activation it belongs to rather than with the state a host is sent: the column is
 * on the app, and a host is told a timeout where its owner sets one.
 */
export const MIN_IDLE_TIMEOUT_MS = 60_000;

/**
 * A day, which is not a judgement about how long an app should wait — `always` is how an owner
 * says never sleep, so any value here is a legal preference and an app visited twice a day may
 * reasonably want hours. It is there to catch the slipped zero: fifteen minutes and two and a
 * half hours are one keystroke apart, and the wrong one costs nothing visible, it just quietly
 * stops saving. Generous enough that it can only ever refuse a typo.
 */
export const MAX_IDLE_TIMEOUT_MS = 86_400_000;

export const IdleTimeoutMsSchema = Type.Integer({
  minimum: MIN_IDLE_TIMEOUT_MS,
  maximum: MAX_IDLE_TIMEOUT_MS,
});
