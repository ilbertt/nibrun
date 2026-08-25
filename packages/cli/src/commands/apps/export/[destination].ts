import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { exportApp } from '#lib/exports.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

export const command = defineCommand('apps export [destination]', {
  description:
    "Download an app's data, the binary that ran against it and a .env of the variables it was deployed with, as a .tar.gz. The destination is the file to write, or a directory to write <app-slug>.tar.gz into.",
  options: {},
  params: {
    destination: {
      schema: z.string().min(1),
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ params, parents, context, print }) => {
    const { api } = context;
    const interactive = isInteractive();
    const ui = createUi({ print, interactive });

    ui.open('nib apps export');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    await exportApp({ api, slug, destination: params.destination, ui });
  },
});
