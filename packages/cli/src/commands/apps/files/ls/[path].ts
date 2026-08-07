import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { SHARED_OPTIONS } from '#config.ts';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { guestPath, listDirectory } from '#lib/filesystem.ts';
import { isInteractive } from '#lib/ui.ts';

export const command = defineCommand('apps files ls [path]', {
  description: 'Directory to list, as a path inside the app filesystem.',
  options: {},
  params: {
    path: {
      schema: z.string().min(1),
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ params, parents, context, print }) => {
    // Parsed before anything is asked for: the read is a wait on a host, and a path that could
    // never have been read is worth one line now rather than one line half a minute from now.
    const path = guestPath(params.path);

    const { api } = context;
    const slug = await selectApp({
      api,
      slug: parents.apps.options.app,
      interactive: isInteractive(),
    });

    await listDirectory({
      api,
      slug,
      deploymentId: parents['apps files ls'].options[SHARED_OPTIONS.deploymentId.name],
      path,
      print,
    });
  },
});
