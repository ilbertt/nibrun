import { defineCommand } from '@parshjs/core';
import { DEFAULT_LOG_TIMERANGE, LOG_TIMERANGE_PATTERN } from '@repo/protocol';
import { z } from 'zod';
import { appBySlug } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { UsageError } from '#lib/errors.ts';
import { follow, latestDeployment, untilInterrupted } from '#lib/logs.ts';

const NO_APP_NAMED = 'Which app? Name one with --app-slug.';

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
    'deployment-id': {
      schema: z.string().min(1).optional(),
      description: 'Read this deployment instead of looking up the app latest.',
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print }) => {
    const slug = parents.apps.options['app-slug'];
    if (slug === undefined) {
      throw new UsageError(NO_APP_NAMED);
    }
    const { api } = context;

    // The app is looked up either way — a deployment is addressed under the app that owns it — so
    // what naming one skips is only the question of which deployment is current.
    const app = await appBySlug({ api, slug });
    const deploymentId =
      options['deployment-id'] ?? (await latestDeployment({ api, appId: app.id }));
    print.dim(`${app.slug} · deployment ${deploymentId}`);

    await follow({
      api,
      appId: app.id,
      deploymentId,
      timerange: options.timerange,
      print,
      signal: untilInterrupted(),
    });
  },
});
