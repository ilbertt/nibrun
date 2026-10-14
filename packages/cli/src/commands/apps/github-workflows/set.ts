import { defineCommand } from '@parshjs/core';
import { readGitHubWorkflow, setGitHubWorkflow } from '@repo/app-operations';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { GITHUB_WORKFLOW_OUTPUT } from '#lib/github-workflows.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps github-workflows set', {
  description:
    'Create or replace the app’s trusted GitHub workflow. Replacing it revokes existing deployment tokens.',
  options: {
    repository: {
      schema: z.string().min(1),
      description: 'GitHub repository in owner/repo form.',
    },
    workflow: {
      schema: z.string().min(1),
      description: 'Workflow filename under .github/workflows, such as deploy.yml.',
    },
    environment: {
      schema: z.string().trim().optional(),
      description: 'Required GitHub environment. Omit or leave empty to remove this restriction.',
    },
  },
  beforeHandler: function signedIn({ context }) {
    return requireSignedIn(context);
  },
  handler: async function set({ options, parents, context, print, rootOptions }) {
    const { interactive, emit } = createOutput({
      output: GITHUB_WORKFLOW_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    const app = await selectApp({ api, name: parents.apps.options.app, interactive });
    const existingWorkflow = await readGitHubWorkflow({ api, appId: app.id });
    const workflow = await setGitHubWorkflow({
      api,
      appId: app.id,
      workflowId: existingWorkflow?.id,
      workflow: {
        repository: options.repository,
        workflow: options.workflow,
        environment: options.environment || null,
      },
    });
    emit({ appId: app.id, workflow });
  },
});
