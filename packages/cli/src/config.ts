import type { CommandOption } from '@parshjs/core';
import { z } from 'zod';

export const PROGRAM_NAME = 'nib';

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
} as const satisfies Record<string, { name: string; option: CommandOption }>;
