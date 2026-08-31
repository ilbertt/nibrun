import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { addAppDomain, DOMAIN_ADDED_OUTPUT } from '#lib/domains.ts';
import { createOutput } from '#lib/output.ts';

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
  handler: async ({ params, parents, context, print, rootOptions }) => {
    const { interactive, ui, emit } = createOutput({
      output: DOMAIN_ADDED_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;

    ui.open('nib apps domains add');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    emit(await addAppDomain({ api, slug, hostname: params.hostname }));
  },
});
