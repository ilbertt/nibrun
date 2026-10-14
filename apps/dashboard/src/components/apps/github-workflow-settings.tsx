import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@repo/ui/components/accordion';
import { Skeleton } from '@repo/ui/components/skeleton';
import { useRef } from 'react';
import { GitHubWorkflowExample } from '#components/apps/github-workflow-example.tsx';
import { GitHubWorkflowForm } from '#components/apps/github-workflow-form.tsx';
import { RemoveGitHubWorkflowDialog } from '#components/apps/remove-github-workflow-dialog.tsx';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { useGitHubWorkflow } from '#lib/hooks/use-github-workflow.ts';

export function GitHubWorkflowSettings() {
  const workflow = useGitHubWorkflow();
  const settings = useRef<HTMLElement>(null);

  return (
    <section
      ref={settings}
      className="flex min-w-0 flex-col gap-6"
      aria-labelledby="github-actions-heading"
    >
      <div className="flex flex-col gap-1.5">
        <h3 id="github-actions-heading" className="font-heading font-medium">
          GitHub Actions
        </h3>
        <p className="text-muted-foreground text-sm">
          Let a trusted GitHub workflow deploy this app without storing deployment secrets.
        </p>
      </div>
      {workflow.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : workflow.isError ? (
        <FailureEmpty title="Could not read the trusted workflow" reason={workflow.error.message} />
      ) : (
        <>
          <GitHubWorkflowForm key={workflow.data?.id ?? 'new'} workflow={workflow.data} />
          {workflow.data !== null && (
            <>
              <Accordion className="min-w-0">
                <AccordionItem>
                  <AccordionTrigger>View workflow example</AccordionTrigger>
                  <AccordionContent>
                    <GitHubWorkflowExample workflow={workflow.data} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <RemoveGitHubWorkflowDialog workflow={workflow.data} finalFocus={settings} />
            </>
          )}
        </>
      )}
    </section>
  );
}
