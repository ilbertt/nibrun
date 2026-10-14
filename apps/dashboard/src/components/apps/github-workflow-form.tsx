import type { GitHubWorkflow } from '@repo/app-operations';
import { Button } from '@repo/ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Spinner } from '@repo/ui/components/spinner';
import type { ReactNode } from 'react';
import { useGitHubWorkflowForm } from '#lib/hooks/use-github-workflow-form.ts';

export function GitHubWorkflowForm({
  workflow,
  children,
  secondaryAction,
}: {
  workflow: GitHubWorkflow | null;
  children: ReactNode;
  secondaryAction: ReactNode;
}) {
  const form = useGitHubWorkflowForm(workflow);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      <fieldset disabled={form.pending} className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="github-repository">Repository</FieldLabel>
          <Input
            id="github-repository"
            value={form.fields.repository}
            placeholder="owner/repository"
            required
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => form.change({ field: 'repository', value: event.target.value })}
          />
          <FieldDescription>GitHub owner and repository name.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="github-workflow">Workflow filename</FieldLabel>
          <Input
            id="github-workflow"
            value={form.fields.workflow}
            placeholder="deploy.yml"
            required
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => form.change({ field: 'workflow', value: event.target.value })}
          />
          <FieldDescription>The filename inside .github/workflows/.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="github-environment">GitHub environment</FieldLabel>
          <Input
            id="github-environment"
            value={form.fields.environment}
            placeholder="production"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => form.change({ field: 'environment', value: event.target.value })}
          />
          <FieldDescription>Optional. Leave empty to allow any environment.</FieldDescription>
        </Field>
      </fieldset>
      {form.error !== undefined && <FieldError>{form.error}</FieldError>}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {form.pending ? <Spinner /> : workflow === null ? 'Trust workflow' : 'Save workflow'}
        </Button>
        {secondaryAction}
      </div>
    </form>
  );
}
