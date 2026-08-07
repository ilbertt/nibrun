import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { requireAppSlug } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { exportApp } from '#lib/exports.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

export const command = defineCommand('apps export [destination]', {
  description:
    "Download an app's data and the binary that ran against it, as a .tar.gz. The destination is the file to write, or a directory to write <app-slug>.tar.gz into.",
  options: {},
  params: {
    destination: {
      schema: z.string().min(1),
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ params, parents, context, print }) => {
    const { api } = context;
    // Nothing to ask about — the destination is the one thing this needs and it was typed — so a
    // terminal only decides how the waiting looks.
    const ui = createUi({ print, interactive: isInteractive() });

    ui.open('nib apps export');
    await exportApp({
      api,
      slug: requireAppSlug(parents.apps.options.app),
      destination: params.destination,
      ui,
    });
  },
});
