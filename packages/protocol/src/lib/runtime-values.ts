export const RUNTIME_VALUE_PREFIX = 'NIBRUN_';

export const RUNTIME_VALUES = {
  DATA_DIR: {
    name: `${RUNTIME_VALUE_PREFIX}DATA_DIR`,
    description: 'the directory the volume is mounted at',
  },
  EXTRA_PUBLIC_PORT: {
    name: `${RUNTIME_VALUE_PREFIX}EXTRA_PUBLIC_PORT`,
    description: 'the port to bind and announce',
  },
  HOSTNAME: {
    name: `${RUNTIME_VALUE_PREFIX}HOSTNAME`,
    description: "the app's own hostname",
  },
  HTTP_PORT: {
    name: `${RUNTIME_VALUE_PREFIX}HTTP_PORT`,
    description: 'the port the binary must listen on',
  },
  PUBLIC_IPV4: {
    name: `${RUNTIME_VALUE_PREFIX}PUBLIC_IPV4`,
    description: 'the address it is reached at',
  },
} as const;

export const RUNTIME_ENVIRONMENT_VALUES = Object.fromEntries(
  Object.entries(RUNTIME_VALUES).map(([key, value]) => [key, value.name]),
) as {
  [Key in keyof typeof RUNTIME_VALUES]: (typeof RUNTIME_VALUES)[Key]['name'];
};

export type RuntimeValue = (typeof RUNTIME_VALUES)[keyof typeof RUNTIME_VALUES];
export type RuntimeValueName = RuntimeValue['name'];
export const RUNTIME_VALUE_NAMES = Object.values(RUNTIME_VALUES).map((value) => value.name);

export const EXTRA_PUBLIC_PORT_VALUES = [
  RUNTIME_VALUES.EXTRA_PUBLIC_PORT,
  RUNTIME_VALUES.PUBLIC_IPV4,
] as const;

const NEEDS_A_PORT = EXTRA_PUBLIC_PORT_VALUES.map((value) => value.name).join('|');
const NAMES_A_PORT = new RegExp(`\\$\\{(?:${NEEDS_A_PORT})\\}`);

export function interpolableRuntimeValue(name: RuntimeValueName): string {
  return `\${${name}}`;
}

export function namesExtraPublicPortValues(value: string): boolean {
  return NAMES_A_PORT.test(value);
}
