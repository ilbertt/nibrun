import type { GitHubWorkflow } from '@repo/app-operations';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@repo/ui/components/alert-dialog';
import { Button } from '@repo/ui/components/button';
import { FieldError } from '@repo/ui/components/field';
import { Spinner } from '@repo/ui/components/spinner';
import { useRemoveGitHubWorkflow } from '#lib/hooks/use-remove-github-workflow.ts';

export function RemoveGitHubWorkflowDialog({ workflow }: { workflow: GitHubWorkflow }) {
  const removal = useRemoveGitHubWorkflow();

  return (
    <AlertDialog onOpenChange={() => removal.reset()}>
      <AlertDialogTrigger render={<Button variant="outline" className="self-start" />}>
        Remove trusted workflow
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove trusted workflow?</AlertDialogTitle>
          <AlertDialogDescription>
            {workflow.repository} can no longer deploy through {workflow.workflow}. Existing
            deployment tokens from this workflow stop working immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {removal.isError && <FieldError>{removal.error.message}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removal.isPending}>Keep workflow</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={removal.isPending}
            onClick={() => removal.mutate(workflow.id)}
          >
            {removal.isPending ? <Spinner /> : 'Remove workflow'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
