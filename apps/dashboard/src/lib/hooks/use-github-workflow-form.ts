import type { GitHubWorkflow } from '@repo/app-operations';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '#lib/api.ts';
import { type GitHubWorkflowFields, saveGitHubWorkflow } from '#lib/github-workflows.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { githubWorkflowQueryOptions } from '#queries/github-workflow.ts';

type GitHubWorkflowForm = {
  fields: GitHubWorkflowFields;
  change: (input: { field: keyof GitHubWorkflowFields; value: string }) => void;
  submit: () => void;
  pending: boolean;
  error: string | undefined;
};

export function useGitHubWorkflowForm(workflow: GitHubWorkflow | null): GitHubWorkflowForm {
  const appId = useAppId();
  const queryClient = useQueryClient();
  const [edited, setEdited] = useState<GitHubWorkflowFields | undefined>(undefined);
  const fields = edited ?? {
    repository: workflow?.repository ?? '',
    workflow: workflow?.workflow ?? 'deploy.yml',
    environment: workflow?.environment ?? '',
  };
  const save = useMutation({
    mutationFn: () => saveGitHubWorkflow({ api, appId, workflowId: workflow?.id, fields }),
    onSuccess: (saved) => {
      queryClient.setQueryData(githubWorkflowQueryOptions(appId).queryKey, saved);
      setEdited(undefined);
    },
  });

  return {
    fields,
    change: ({ field, value }) => {
      setEdited({ ...fields, [field]: value });
      save.reset();
    },
    submit: () => save.mutate(),
    pending: save.isPending,
    error: save.error?.message,
  };
}
