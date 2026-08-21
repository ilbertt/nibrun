import { defineCommand } from '@parshjs/core';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { resumeApp } from '#lib/suspend.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

export const command = defineCommand('apps resume', {
  description:
    'Put a suspended app back online. The host boots the deployment it was suspended on, onto the volume it left behind.',
  options: {},
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ parents, context, print }) => {
    const { api } = context;
    const interactive = isInteractive();
    const ui = createUi({ print, interactive });

    ui.open('nib apps resume');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    await resumeApp({ api, slug, ui });
  },
});
