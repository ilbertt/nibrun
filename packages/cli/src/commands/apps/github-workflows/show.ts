import { defineCommand } from '@parshjs/core';
import { readGitHubWorkflow } from '@repo/app-operations';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { GITHUB_WORKFLOW_OUTPUT } from '#lib/github-workflows.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps github-workflows show', {
  description: 'Show the repository, workflow and environment allowed to deploy this app.',
  options: {},
  beforeHandler: function signedIn({ context }) {
    return requireSignedIn(context);
  },
  handler: async function show({ parents, context, print, rootOptions }) {
    const { interactive, emit } = createOutput({
      output: GITHUB_WORKFLOW_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    const app = await selectApp({ api, name: parents.apps.options.app, interactive });
    emit({ appId: app.id, workflow: await readGitHubWorkflow({ api, appId: app.id }) });
  },
});
