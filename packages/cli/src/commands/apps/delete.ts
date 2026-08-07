import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { requireAppSlug } from '#lib/apps.ts';
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
    // Elsewhere a terminal decides how the output looks. Here it also decides whether the question
    // can be asked at all, which is why the handler keeps the answer rather than only the `ui`.
    const interactive = isInteractive();
    const ui = createUi({ print, interactive });

    ui.open('nib apps delete');
    await deleteApp({
      api: context.api,
      slug: requireAppSlug(parents.apps.options.app),
      ui,
      yes: options.yes === true,
      interactive,
    });
  },
});
