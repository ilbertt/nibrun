import { defineCommand } from '@parshjs/core';
import { SHARED_OPTIONS } from '#config.ts';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { CRONS_OUTPUT, listCrons } from '#lib/crons.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps crons', {
  description: 'List cron jobs registered by an app.',
  options: {
    [SHARED_OPTIONS.deploymentId.name]: SHARED_OPTIONS.deploymentId.option,
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print, rootOptions }) => {
    const { interactive, aside, emit } = createOutput({
      output: CRONS_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const app = await selectApp({
      api: context.api,
      name: parents.apps.options.app,
      interactive,
    });
    emit(
      await listCrons({
        api: context.api,
        appId: app.id,
        deploymentId: options[SHARED_OPTIONS.deploymentId.name],
        print: aside,
      }),
    );
  },
});
