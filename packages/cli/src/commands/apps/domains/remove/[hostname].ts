import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { removeAppDomain } from '#lib/domains.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

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
  handler: async ({ params, parents, context, print }) => {
    const { api } = context;
    const interactive = isInteractive();
    const ui = createUi({ print, interactive });

    ui.open('nib apps domains remove');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    await removeAppDomain({ api, slug, hostname: params.hostname, ui });
  },
});
