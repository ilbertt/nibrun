import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { Skeleton } from '@repo/ui/components/skeleton';
import { GitHubWorkflowExample } from '#components/apps/github-workflow-example.tsx';
import { GitHubWorkflowForm } from '#components/apps/github-workflow-form.tsx';
import { RemoveGitHubWorkflowDialog } from '#components/apps/remove-github-workflow-dialog.tsx';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { useGitHubWorkflow } from '#lib/hooks/use-github-workflow.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

export function GitHubWorkflowCard() {
  const workflow = useGitHubWorkflow();
  if (useSessionIdentity() !== SessionIdentity.WithAccount) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub Actions</CardTitle>
        <CardDescription>
          Let a trusted GitHub workflow deploy this app without storing deployment secrets.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {workflow.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : workflow.isError ? (
          <FailureEmpty
            title="Could not read the trusted workflow"
            reason={workflow.error.message}
          />
        ) : (
          <>
            <GitHubWorkflowForm key={workflow.data?.id ?? 'new'} workflow={workflow.data} />
            {workflow.data !== null && (
              <>
                <GitHubWorkflowExample workflow={workflow.data} />
                <RemoveGitHubWorkflowDialog workflow={workflow.data} />
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
