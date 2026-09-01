import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { DELETED_OUTPUT, deleteApp } from '#lib/delete.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps delete', {
  description:
    'Delete an app: everything on its volume, every binary uploaded to it and every export taken of it. There is no undo.',
  options: {
    yes: {
      schema: z.boolean().optional(),
      aliases: ['y'],
      description: 'Delete it without being asked to confirm.',
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print, rootOptions }) => {
    // A terminal decides more here than how the output looks — which app, when the flag named
    // none, and whether the confirmation can be asked at all — so the handler keeps the answer
    // rather than only the `ui` built from it.
    const { interactive, ui, emit } = createOutput({
      output: DELETED_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;

    ui.open('nib apps delete');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    emit(await deleteApp({ api, slug, yes: options.yes === true, interactive }));
  },
});
