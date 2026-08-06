import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
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
    app: {
      schema: z.string().optional(),
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
    vcpu: { schema: z.number().int().optional(), description: 'vCPUs the guest is given.' },
    memory: {
      schema: z.number().int().optional(),
      description: 'Memory the guest is given, in MiB.',
    },
    detach: {
      schema: z.boolean().optional(),
      aliases: ['d'],
      description: 'Return once the deployment is created instead of waiting for it to serve.',
    },
    yes: {
      schema: z.boolean().optional(),
      aliases: ['y'],
      description: 'Take the defaults for anything not given instead of asking.',
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ params, options, context, print }) => {
    const { yes, detach, ...given } = options;
    const { binaryPath, args } = parseCommandLine(params.command);
    const { api } = context;

    // A terminal decides how this looks; `--yes` only decides whether it asks. Someone who wants
    // the defaults taken has not thereby asked for the output of a log file.
    const interactive = isInteractive();
    const ui = createUi({ print, interactive });

    // Before anything is asked, so a path nobody can read costs one line rather than a
    // questionnaire whose answers are then thrown away.
    const binary = await readBinary(binaryPath);
    ui.open('nib run');

    const resolved =
      interactive && yes !== true
        ? await completeOptions({ api, options: given, binaryPath, args })
        : given;

    await deploy({ ...resolved, api, ui, binary, args, detach });
  },
});
