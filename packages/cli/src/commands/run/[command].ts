import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { SHARED_OPTIONS } from '#config.ts';
import { parseCommandLine } from '#lib/command-line.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { deploy, readBinary } from '#lib/deploy.ts';
import { completeOptions } from '#lib/plan.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

export const command = defineCommand('run [command]', {
  description:
    'Deploy a compiled binary and run it. Quote the binary with its arguments to pass them on: nib run "./my-server serve --port 8080".',
  params: {
    command: { schema: z.string().min(1) },
  },
  options: {
    [SHARED_OPTIONS.app.name]: {
      ...SHARED_OPTIONS.app.option,
      description: 'Slug of an existing app to deploy onto. Asked for when omitted.',
    },
    name: {
      schema: z.string().optional(),
      description: 'Name for the new app. Defaults to the binary filename.',
    },
    port: {
      schema: z.number().int().optional(),
      description: 'Port the binary listens on inside the guest.',
    },
    detach: {
      schema: z.boolean().optional(),
      aliases: ['d'],
      description: 'Return once the deployment is created instead of waiting for it to serve.',
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ params, options, context, print }) => {
    const { detach, ...given } = options;
    const { binaryPath, args } = parseCommandLine(params.command);
    const { api } = context;

    const interactive = isInteractive();
    const ui = createUi({ print, interactive });

    // Before anything is asked, so a path nobody can read costs one line rather than a
    // questionnaire whose answers are then thrown away.
    const binary = await readBinary(binaryPath);
    ui.open('nib run');

    const resolved = interactive
      ? await completeOptions({ api, options: given, binaryPath, args })
      : given;

    await deploy({ ...resolved, api, ui, binary, args, detach });
  },
});
