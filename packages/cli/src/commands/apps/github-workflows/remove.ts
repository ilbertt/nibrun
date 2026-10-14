import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import {
  confirmAndRemoveGitHubWorkflow,
  GITHUB_WORKFLOW_REMOVED_OUTPUT,
} from '#lib/github-workflows.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps github-workflows remove', {
  description: 'Remove the trusted GitHub workflow and revoke its existing deployment tokens.',
  options: {
    yes: {
      schema: z.boolean().optional(),
      aliases: ['y'],
      description: 'Remove it without being asked to confirm.',
    },
  },
  beforeHandler: function signedIn({ context }) {
    return requireSignedIn(context);
  },
  handler: async function remove({ options, parents, context, print, rootOptions }) {
    const { interactive, emit } = createOutput({
      output: GITHUB_WORKFLOW_REMOVED_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    const app = await selectApp({ api, name: parents.apps.options.app, interactive });
    emit(
      await confirmAndRemoveGitHubWorkflow({ api, app, yes: options.yes === true, interactive }),
    );
  },
});
