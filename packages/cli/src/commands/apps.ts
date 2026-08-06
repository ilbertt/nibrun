import { defineCommand } from '@parshjs/core';
import { z } from 'zod';

/**
 * A group rather than a command. Naming an app is what everything under here has in common, so
 * the flag that names one is declared once and forwarded rather than repeated on each child —
 * which is also what makes `nib apps --app-slug x logs` and `nib apps logs --app-slug x` the same
 * thing said two ways.
 *
 * No handler, so asking for nothing is answered with what can be asked for. Optional even though
 * every child needs it: a required flag would make `nib apps` an error rather than a list.
 */
export const command = defineCommand('apps', {
  description: 'Work with one of your apps.',
  options: {
    'app-slug': {
      schema: z.string().min(1).optional(),
      forwardToChildren: true,
      description: 'Slug of the app to work with.',
    },
  },
});
