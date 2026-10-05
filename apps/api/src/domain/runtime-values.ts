import { RUNTIME_ENVIRONMENT_VALUES, TenantEnvironmentSchema } from '@repo/protocol';

/**
 * Every runtime value the guest sets, spelled as it is written, against what it holds. The value
 * is carried because a name on its own tells a reader nothing, and every end that lists them has
 * somewhere to say which is which.
 *
 * The wire names come from protocol; this record adds descriptions for API consumers.
 * Two places cannot import it and have to be changed by hand:
 * `reference_value` in `apps/runtime/src/config.c`, which is what actually substitutes them, and
 * `skills/deploy-to-nibrun/SKILL.md`, which is what tells an agent they exist.
 */
export const RUNTIME_VALUES = {
  DATA_DIR: {
    name: RUNTIME_ENVIRONMENT_VALUES.DATA_DIR,
    description: 'the directory the volume is mounted at',
  },
  EXTRA_PUBLIC_PORT: {
    name: RUNTIME_ENVIRONMENT_VALUES.EXTRA_PUBLIC_PORT,
    description: 'the port to bind and announce',
  },
  HOSTNAME: {
    name: RUNTIME_ENVIRONMENT_VALUES.HOSTNAME,
    description: "the app's own hostname",
  },
  HTTP_PORT: {
    name: RUNTIME_ENVIRONMENT_VALUES.HTTP_PORT,
    description: 'the port the binary must listen on',
  },
  PUBLIC_IPV4: {
    name: RUNTIME_ENVIRONMENT_VALUES.PUBLIC_IPV4,
    description: 'the address it is reached at',
  },
} as const;

export type RuntimeValue = (typeof RUNTIME_VALUES)[keyof typeof RUNTIME_VALUES];

/** A name the record holds, so anything naming one is a rename away from failing to compile. */
export type RuntimeValueName = RuntimeValue['name'];

/**
 * The names alone, in the order they are written above. The guest fails the boot over one it does
 * not offer, so a value naming anything else is refused here instead, while whoever typed it is
 * still listening.
 */
export const RUNTIME_VALUE_NAMES: readonly RuntimeValueName[] = Object.values(RUNTIME_VALUES).map(
  (value) => value.name,
);

/**
 * The two the guest is only given when the app asked for a public port besides HTTP. Naming one on
 * an app without it fails the boot — the runtime refuses a reference it was not given rather than
 * expanding it to nothing — so the pair has to be answerable here, where the config that decides it
 * is also being written.
 *
 * Entries of the record above rather than a second list, so one of these can only be a value the
 * guest offers at all.
 */
export const EXTRA_PUBLIC_PORT_VALUES = [
  RUNTIME_VALUES.EXTRA_PUBLIC_PORT,
  RUNTIME_VALUES.PUBLIC_IPV4,
] as const;

const NEEDS_A_PORT = EXTRA_PUBLIC_PORT_VALUES.map((value) => value.name).join('|');

const TENANT_VALUE_PATTERN = Object.values(TenantEnvironmentSchema.patternProperties)[0]!.pattern;

const TENANT_VALUE = new RegExp(TENANT_VALUE_PATTERN!);

/**
 * Whether every runtime value `value` names is one the guest offers, which most values name none
 * of. The same rule the schema carries, for a caller with somewhere better to report it than a
 * pattern nobody can read.
 */
export function namesOfferedRuntimeValues(value: string): boolean {
  return TENANT_VALUE.test(value);
}

/** A runtime value as it is named in a tenant value, which is the form worth showing back. */
export function interpolableRuntimeValue(name: string): string {
  return `\${${name}}`;
}

// Whether these references are allowed depends on the app's public-port config.
const NAMES_A_PORT = new RegExp(`\\$\\{(?:${NEEDS_A_PORT})\\}`);

/** Whether `value` names a runtime value only an app with an extra public port is given. */
export function namesExtraPublicPortValues(value: string): boolean {
  return NAMES_A_PORT.test(value);
}
