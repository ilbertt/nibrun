import { defineCommand } from '@parshjs/core';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { suspendApp } from '#lib/suspend.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

export const command = defineCommand('apps suspend', {
  description:
    'Take the app offline. Its microVM stops; the volume, everything on it and every hostname stay. `nib apps resume` puts it back.',
  options: {},
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ parents, context, print }) => {
    const { api } = context;
    const interactive = isInteractive();
    const ui = createUi({ print, interactive });

    ui.open('nib apps suspend');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    await suspendApp({ api, slug, ui });
  },
});
