import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { SHARED_OPTIONS } from '#config.ts';
import { selectApp } from '#lib/apps.ts';
import { parseArguments } from '#lib/command-line.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import { RELEASE_OUTPUT } from '#lib/release.ts';
import { updateApp } from '#lib/update.ts';

export const command = defineCommand('apps update', {
  description:
    'Change how the app starts and run it again on the binary it already has. Nothing is uploaded, and whatever no flag names is left as it is.',
  options: {
    args: {
      schema: z.string().optional(),
      description:
        'Arguments to start the binary with, quoted as one value: --args "serve --verbose". An empty value runs it bare.',
    },
    [SHARED_OPTIONS.port.name]: SHARED_OPTIONS.port.option,
    [SHARED_OPTIONS.extraPublicPort.name]: SHARED_OPTIONS.extraPublicPort.option,
    [SHARED_OPTIONS.env.name]: SHARED_OPTIONS.env.option,
    [SHARED_OPTIONS.unset.name]: SHARED_OPTIONS.unset.option,
    [SHARED_OPTIONS.detach.name]: SHARED_OPTIONS.detach.option,
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print, rootOptions }) => {
    const { args, ...given } = options;
    const { interactive, ui, emit } = createOutput({
      output: RELEASE_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;

    ui.open('nib apps update');
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    emit(
      await updateApp({
        api,
        ui,
        slug,
        args: args === undefined ? undefined : parseArguments(args),
        port: given[SHARED_OPTIONS.port.name],
        extraPublicPort: given[SHARED_OPTIONS.extraPublicPort.name],
        env: given[SHARED_OPTIONS.env.name],
        unset: given[SHARED_OPTIONS.unset.name],
        detach: given[SHARED_OPTIONS.detach.name],
      }),
    );
  },
});
