import { defineCommand } from '@parshjs/core';
import { z } from 'zod';

export const command = defineCommand('apps sqlite query', {
  description: 'Run read-only SQL against an app’s running deployment.',
  options: {
    connection: {
      schema: z.string().min(1).optional(),
      forwardToChildren: true,
      description:
        'Saved connection ID. Uses the only connection or asks which database when omitted; required in scripts when the app has several connections.',
    },
  },
});
