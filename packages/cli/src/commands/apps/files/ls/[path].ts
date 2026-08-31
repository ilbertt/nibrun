import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { SHARED_OPTIONS } from '#config.ts';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { DIRECTORY_OUTPUT, listDirectory, typedPath } from '#lib/filesystem.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps files ls [path]', {
  description: 'Directory to list, as a path inside the app filesystem.',
  options: {},
  params: {
    path: {
      schema: z.string().min(1),
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ params, parents, context, print, rootOptions }) => {
    // Parsed before anything is asked for: the read is a wait on a host, and a path that could
    // never have been read is worth one line now rather than one line half a minute from now.
    const path = typedPath(params.path);

    const { interactive, aside, emit } = createOutput({
      output: DIRECTORY_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    emit(
      await listDirectory({
        api,
        slug,
        deploymentId: parents['apps files ls'].options[SHARED_OPTIONS.deploymentId.name],
        path,
        print: aside,
      }),
    );
  },
});
