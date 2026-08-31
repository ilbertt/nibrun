import { defineRootCommand } from '@parshjs/core';
import { z } from 'zod';

export const command = defineRootCommand({
  options: {
    json: {
      schema: z.boolean().default(false),
      forwardToChildren: true,
      description: 'Print what the command answered with as JSON, one object to a line.',
    },
  },
});
