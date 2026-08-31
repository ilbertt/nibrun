import { defineCommand } from '@parshjs/core';
import { APP_STATUS_OUTPUT, readStatus } from '#lib/app-status.ts';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps status', {
  description:
    'What one app is using of the machine it was given: vCPU, memory and volume, as the host last measured them.',
  options: {},
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ parents, context, print, rootOptions }) => {
    const { interactive, emit } = createOutput({
      output: APP_STATUS_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    emit(await readStatus({ api, slug }));
  },
});
