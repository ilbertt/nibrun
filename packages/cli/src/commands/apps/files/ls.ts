import { defineCommand } from '@parshjs/core';
import { GUEST_PATH_ROOT } from '@repo/protocol';
import { DEPLOYMENT_ID_OPTION, SharedOption } from '#config.ts';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { listDirectory } from '#lib/filesystem.ts';
import { isInteractive } from '#lib/ui.ts';

/**
 * A command and the parent of `apps files ls [path]` at once, which is how an optional positional
 * is spelled: the walk stops here when nothing follows, and the volume's root is what listing
 * without naming a directory means. `--deployment-id` is declared here and forwarded, so both
 * spellings take it the same way.
 */
export const command = defineCommand('apps files ls', {
  description: "List a directory of an app's filesystem. Without a path, the volume root.",
  options: {
    [SharedOption.DeploymentId]: { ...DEPLOYMENT_ID_OPTION, forwardToChildren: true },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print }) => {
    const { api } = context;
    const slug = await selectApp({
      api,
      slug: parents.apps.options.app,
      interactive: isInteractive(),
    });

    await listDirectory({
      api,
      slug,
      deploymentId: options[SharedOption.DeploymentId],
      path: GUEST_PATH_ROOT,
      print,
    });
  },
});
