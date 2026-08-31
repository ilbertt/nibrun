import { defineCommand } from '@parshjs/core';
import { DEFAULT_LOG_TIMERANGE, LOG_TIMERANGE_PATTERN } from '@repo/protocol';
import { z } from 'zod';
import { SHARED_OPTIONS } from '#config.ts';
import { announcedDeployment, selectApp, stillWriting } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { follow, LOG_RECORD_OUTPUT, untilInterrupted } from '#lib/logs.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps logs', {
  description: 'Print an app output and keep printing it. Ends when you do.',
  options: {
    timerange: {
      schema: z
        .string()
        .regex(
          new RegExp(LOG_TIMERANGE_PATTERN),
          'A timerange is a duration such as 30s, 5m or 2h.',
        )
        .default(DEFAULT_LOG_TIMERANGE),
      description: 'How much history to print before following.',
    },
    [SHARED_OPTIONS.deploymentId.name]: SHARED_OPTIONS.deploymentId.option,
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print, rootOptions }) => {
    const { interactive, aside, emit } = createOutput({
      output: LOG_RECORD_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });
    const addressed = await announcedDeployment({
      api,
      slug,
      deploymentId: options[SHARED_OPTIONS.deploymentId.name],
      operation: 'logs',
      print: aside,
    });

    await follow({
      api,
      appId: addressed.appId,
      deploymentId: addressed.deploymentId,
      timerange: options.timerange,
      following: stillWriting(addressed),
      emit,
      print: aside,
      signal: untilInterrupted(),
    });
  },
});
