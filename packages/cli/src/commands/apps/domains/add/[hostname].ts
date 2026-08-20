import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { addAppDomain } from '#lib/domains.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

export const command = defineCommand('apps domains add [hostname]', {
  description:
    'Point a domain you own at this app. Prints the two DNS records to add; the app answers on it once they resolve.',
  options: {},
  params: {
    hostname: {
      schema: z.string().min(1),
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ params, parents, context, print }) => {
    const { api } = context;
    const interactive = isInteractive();
    const ui = createUi({ print, interactive });

    ui.open('nib apps domains add');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    await addAppDomain({ api, slug, hostname: params.hostname, ui });
  },
});
