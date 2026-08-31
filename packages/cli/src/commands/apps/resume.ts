import { defineCommand } from '@parshjs/core';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import { RESUMED_OUTPUT, resumeApp } from '#lib/suspend.ts';

export const command = defineCommand('apps resume', {
  description:
    'Put a suspended app back online. The host boots the deployment it was suspended on, onto the volume it left behind.',
  options: {},
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ parents, context, print, rootOptions }) => {
    const { interactive, ui, emit } = createOutput({
      output: RESUMED_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;

    ui.open('nib apps resume');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    emit(await resumeApp({ api, slug }));
  },
});
