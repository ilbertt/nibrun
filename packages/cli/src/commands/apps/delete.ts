import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { deleteApp } from '#lib/delete.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

export const command = defineCommand('apps delete', {
  description:
    'Delete an app: every deployment of it and everything on its volume. There is no undo.',
  options: {
    yes: {
      schema: z.boolean().optional(),
      aliases: ['y'],
      description: 'Delete it without being asked to confirm.',
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print }) => {
    const { api } = context;
    // A terminal decides more here than how the output looks — which app, when the flag named
    // none, and whether the confirmation can be asked at all — so the handler keeps the answer
    // rather than only the `ui` built from it.
    const interactive = isInteractive();
    const ui = createUi({ print, interactive });

    ui.open('nib apps delete');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    await deleteApp({ api, slug, ui, yes: options.yes === true, interactive });
  },
});
