import type { CommandOption } from '@parshjs/core';
import { RUNTIME_VALUE_NAMES } from '@repo/protocol';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };

export const PROGRAM_NAME = 'nib';

export const PROGRAM_VERSION = packageJson.version;

export const DEFAULT_API_URL = 'https://app.nibrun.com';

/**
 * A flag more than one command takes, held as both the name parsh spells it by and the declaration
 * that name points at, so neither half can drift between the commands taking it. A site adds only
 * what genuinely differs there: whether it forwards, and a description where the same value means a
 * different thing to each command.
 */
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
      description: `Set an environment variable for the binary, as NAME=value. Repeatable. Anything the app already has and this does not name is left as it is. A value may name one the guest sets — ${RUNTIME_VALUE_NAMES.join(', ')} — quote it, as in 'URL=https://\${NIBRUN_HOSTNAME}', or the shell expands it here instead.`,
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
