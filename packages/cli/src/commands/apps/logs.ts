import { defineCommand } from '@parshjs/core';
import { DEFAULT_LOG_TIMERANGE, LOG_TIMERANGE_PATTERN } from '@repo/api-constants';
import { z } from 'zod';
import { SHARED_OPTIONS } from '#config.ts';
import { announcedDeployment, selectApp, stillWriting } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { LOG_RECORD_OUTPUT, readLogs, untilInterrupted } from '#lib/logs.ts';
import { createOutput } from '#lib/output.ts';

const FOLLOW_FLAG = 'follow';

export const command = defineCommand('apps logs', {
  description: `Print an app output and exit. Use --${FOLLOW_FLAG} to keep printing live output.`,
  options: {
    [FOLLOW_FLAG]: {
      schema: z.boolean().default(false),
      aliases: ['f'],
      description: 'Keep printing new output until interrupted.',
    },
    timerange: {
      schema: z
        .string()
        .regex(
          new RegExp(LOG_TIMERANGE_PATTERN),
          'A timerange is a duration such as 30s, 5m or 2h.',
        )
        .default(DEFAULT_LOG_TIMERANGE),
      description: 'How much recent history to print.',
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
    const app = await selectApp({ api, name: parents.apps.options.app, interactive });
    const addressed = await announcedDeployment({
      api,
      appId: app.id,
      deploymentId: options[SHARED_OPTIONS.deploymentId.name],
      operation: 'logs',
      print: aside,
    });

    await readLogs({
      api,
      appId: addressed.appId,
      deploymentId: addressed.deploymentId,
      timerange: options.timerange,
      follow: options[FOLLOW_FLAG],
      live: stillWriting(addressed),
      emit,
      print: aside,
      signal: untilInterrupted(),
    });
  },
});
