import type { CommandOption } from '@parshjs/core';
import { DASHBOARD_SITE } from '@repo/global-constants';
import { EXTRA_PUBLIC_PORT_VALUES, RUNTIME_VALUE_NAMES } from '@repo/protocol';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };

export const PROGRAM_NAME = 'nib';

export const PROGRAM_VERSION = packageJson.version;

export const DEFAULT_API_URL = DASHBOARD_SITE.url;

/**
 * A flag more than one command takes, held as both the name parsh spells it by and the declaration
 * that name points at, so neither half can drift between the commands taking it. A site adds only
 * what genuinely differs there: whether it forwards, and a description where the same value means a
 * different thing to each command.
 */
// Reached by two of the descriptions below, and a record cannot read its own entries while it is
// being built — so the one flag another flag has to name is a constant before either of them.
const EXTRA_PUBLIC_PORT_FLAG = 'extra-public-port';

const PORT_VALUE_NAMES = EXTRA_PUBLIC_PORT_VALUES.map((value) => value.name).join(' and ');

export const SHARED_OPTIONS = {
  app: {
    name: 'app',
    option: { schema: z.string().min(1).optional() },
  },
  deploymentId: {
    name: 'deployment-id',
    option: {
      schema: z.string().min(1).optional(),
      description: 'Read this deployment instead of looking up the app latest.',
    },
  },
  port: {
    name: 'port',
    option: {
      schema: z.number().int().optional(),
      description: 'HTTP port the binary listens on inside the guest.',
    },
  },
  env: {
    name: 'env',
    option: {
      schema: z.array(z.string()).optional(),
      description: `Set an environment variable for the binary, as NAME=value. Repeatable. Anything the app already has and this does not name is left as it is. A value may name one the guest sets — ${RUNTIME_VALUE_NAMES.join(', ')} — quote it, as in 'URL=https://\${NIBRUN_HOSTNAME}', or the shell expands it here instead. ${PORT_VALUE_NAMES} need --${EXTRA_PUBLIC_PORT_FLAG} on the same app.`,
    },
  },
  extraPublicPort: {
    name: EXTRA_PUBLIC_PORT_FLAG,
    option: {
      schema: z.boolean().optional(),
      description: `Give the app a public TCP and UDP port of its own, for a protocol HTTPS cannot carry. The number is assigned rather than chosen, and the guest is told which address and port it was given, as ${PORT_VALUE_NAMES}. Pass --${EXTRA_PUBLIC_PORT_FLAG}=false to give it up.`,
    },
  },
  unset: {
    name: 'unset',
    option: {
      schema: z.array(z.string()).optional(),
      description: 'Remove an environment variable from the app, by name. Repeatable.',
    },
  },
  detach: {
    name: 'detach',
    option: {
      schema: z.boolean().optional(),
      aliases: ['d'],
      description: 'Return once the deployment is created instead of waiting for it to serve.',
    },
  },
} as const satisfies Record<string, { name: string; option: CommandOption }>;
