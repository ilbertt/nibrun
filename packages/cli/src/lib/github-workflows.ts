import { text } from '@clack/prompts';
import type { PublicApiClient } from '@repo/api-client/public';
import {
  type GitHubWorkflow,
  readGitHubWorkflow,
  removeGitHubWorkflow,
} from '@repo/app-operations';
import { z } from 'zod';
import type { AddressedApp } from '#lib/apps.ts';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';
import { answered } from '#lib/prompts.ts';

const REMOVAL_PHRASE = 'remove workflow';

const GitHubWorkflowSchema = z.object({
  id: z.string(),
  repository: z.string(),
  workflow: z.string(),
  branch: z.string(),
  environment: z.string().nullable(),
}) satisfies z.ZodType<GitHubWorkflow>;

export const GITHUB_WORKFLOW_OUTPUT = defineOutput({
  schema: z.object({ appId: z.string(), workflow: GitHubWorkflowSchema.nullable() }),
  render: function render({ value, out }) {
    out.dim(`app: ${value.appId}`);
    if (!value.workflow) {
      out.info('No trusted GitHub workflow. Use `nib apps github-workflows set` to add one.');
      return;
    }
    out.info(`repository: ${value.workflow.repository}`);
    out.info(`workflow: ${value.workflow.workflow}`);
    out.info(`branch: ${value.workflow.branch}`);
    out.info(`environment: ${value.workflow.environment ?? 'unrestricted'}`);
    out.dim(`workflow ID: ${value.workflow.id}`);
  },
});

export const GITHUB_WORKFLOW_REMOVED_OUTPUT = defineOutput({
  schema: z.object({ appId: z.string(), workflowId: z.string(), removed: z.literal(true) }),
  render: function render({ value, out }) {
    out.done(`Removed trusted GitHub workflow ${value.workflowId} from app ${value.appId}.`);
  },
});

export async function confirmAndRemoveGitHubWorkflow({
  api,
  app,
  yes,
  interactive,
}: {
  api: PublicApiClient;
  app: AddressedApp;
  yes: boolean;
  interactive: boolean;
}) {
  const workflow = await readGitHubWorkflow({ api, appId: app.id });
  if (!workflow) {
    throw new UsageError(`No trusted GitHub workflow configured for ${app.name}.`);
  }
  if (!yes) {
    await confirmRemoval({ name: app.name, workflow, interactive });
  }
  await removeGitHubWorkflow({ api, appId: app.id, workflowId: workflow.id });
  return { appId: app.id, workflowId: workflow.id, removed: true as const };
}

async function confirmRemoval({
  name,
  workflow,
  interactive,
}: {
  name: string;
  workflow: GitHubWorkflow;
  interactive: boolean;
}): Promise<void> {
  if (!interactive) {
    throw new UsageError(
      `Removing the trusted GitHub workflow revokes its deployment tokens. Pass --yes to mean it.`,
    );
  }
  answered(
    await text({
      message: `Type ${REMOVAL_PHRASE} to remove ${workflow.repository}/${workflow.workflow} from ${name}`,
      validate: function validate(value) {
        return value?.trim().toLowerCase() === REMOVAL_PHRASE
          ? undefined
          : `Type ${REMOVAL_PHRASE}, or press Ctrl-C to keep the workflow.`;
      },
    }),
  );
}
