import { defineCommand } from '@parshjs/core';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import { SUSPENDED_OUTPUT, suspendApp } from '#lib/suspend.ts';

export const command = defineCommand('apps suspend', {
  description:
    'Take the app offline. Its microVM stops; the volume, everything on it and every hostname stay. `nib apps resume` puts it back.',
  options: {},
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ parents, context, print, rootOptions }) => {
    const { interactive, ui, emit } = createOutput({
      output: SUSPENDED_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;

    ui.open('nib apps suspend');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    emit(await suspendApp({ api, slug }));
  },
});
