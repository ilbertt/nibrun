import { defineCommand } from '@parshjs/core';
import { GUEST_PATH_ROOT } from '@repo/protocol';
import { SHARED_OPTIONS } from '#config.ts';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { DIRECTORY_OUTPUT, listDirectory } from '#lib/filesystem.ts';
import { createOutput } from '#lib/output.ts';

/**
 * A command and the parent of `apps files ls [path]` at once, which is how an optional positional
 * is spelled: the walk stops here when nothing follows, and the volume's root is what listing
 * without naming a directory means. `--deployment-id` is declared here and forwarded, so both
 * spellings take it the same way.
 */
export const command = defineCommand('apps files ls', {
  description: "List a directory of an app's filesystem. Without a path, the volume root.",
  options: {
    [SHARED_OPTIONS.deploymentId.name]: {
      ...SHARED_OPTIONS.deploymentId.option,
      forwardToChildren: true,
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print, rootOptions }) => {
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
        deploymentId: options[SHARED_OPTIONS.deploymentId.name],
        path: GUEST_PATH_ROOT,
        print: aside,
      }),
    );
  },
});
