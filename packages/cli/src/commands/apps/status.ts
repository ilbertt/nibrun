import { defineCommand } from '@parshjs/core';
import { showStatus } from '#lib/app-status.ts';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { isInteractive } from '#lib/ui.ts';

export const command = defineCommand('apps status', {
  description:
    'What one app is using of the machine it was given: vCPU, memory and volume, as the host last measured them.',
  options: {},
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ parents, context, print }) => {
    const { api } = context;
    const slug = await selectApp({
      api,
      slug: parents.apps.options.app,
      interactive: isInteractive(),
    });

    await showStatus({ api, slug, print });
  },
});
