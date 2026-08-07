import { defineCommand } from '@parshjs/core';
import { GUEST_PATH_ROOT } from '@repo/protocol';
import { z } from 'zod';
import { requireAppSlug } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { listDirectory } from '#lib/filesystem.ts';

/**
 * A command and the parent of `apps ls [path]` at once, which is how an optional positional is
 * spelled: the walk stops here when nothing follows, and the volume's root is what listing
 * without naming a directory means. `--deployment-id` is declared here and forwarded, so both
 * spellings take it the same way.
 */
export const command = defineCommand('apps ls', {
  description: "List a directory of an app's filesystem. Without a path, the volume root.",
  options: {
    'deployment-id': {
      schema: z.string().min(1).optional(),
      forwardToChildren: true,
      description: 'Read this deployment instead of looking up the app latest.',
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print }) => {
    await listDirectory({
      api: context.api,
      slug: requireAppSlug(parents.apps.options.app),
      deploymentId: options['deployment-id'],
      path: GUEST_PATH_ROOT,
      print,
    });
  },
});
