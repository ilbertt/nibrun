import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { DOMAIN_REMOVED_OUTPUT, removeAppDomain } from '#lib/domains.ts';
import { createOutput } from '#lib/output.ts';

// Unasked, unlike `apps delete`: the app keeps running on every other hostname, and re-adding
// this one costs the same two records it cost the first time.
export const command = defineCommand('apps domains remove [hostname]', {
  description: 'Stop serving this app on a domain you brought. The app keeps its other hostnames.',
  options: {},
  params: {
    hostname: {
      schema: z.string().min(1),
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ params, parents, context, print, rootOptions }) => {
    const { interactive, ui, emit } = createOutput({
      output: DOMAIN_REMOVED_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;

    ui.open('nib apps domains remove');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    emit(await removeAppDomain({ api, slug, hostname: params.hostname }));
  },
});
