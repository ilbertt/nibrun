import { Field, FieldDescription, FieldError, FieldTitle } from '@repo/ui/components/field';
import { EnvironmentTable } from '#components/apps/environment-table.tsx';
import { storedVariables } from '#lib/environment-variables.ts';
import { type DeployFormApi, validateEnvironment } from '#lib/hooks/use-deploy-form.ts';
import type { AppSummary } from '#queries/apps.ts';

const TITLE_ID = 'deploy-environment-title';

export function DeployEnvironmentField({
  api,
  replacing,
}: {
  api: DeployFormApi;
  replacing: AppSummary | undefined;
}) {
  return (
    <api.Field name="environment" validators={{ onChange: validateEnvironment }}>
      {(field) => (
        <Field
          aria-labelledby={TITLE_ID}
          data-invalid={field.state.meta.errors.length > 0 || undefined}
        >
          <FieldTitle id={TITLE_ID}>Environment</FieldTitle>
          {/* Seeded from the app rather than held in the form until something is edited: the app
              is read while the dialog is already open, and defaults are fixed when it mounts. */}
          <EnvironmentTable
            variables={field.state.value ?? storedVariables(replacing)}
            onChange={field.handleChange}
          />
          {field.state.meta.errors.length > 0 ? (
            <FieldError>{field.state.meta.errors[0]}</FieldError>
          ) : (
            <FieldDescription>{describeEnvironment(replacing)}</FieldDescription>
          )}
        </Field>
      )}
    </api.Field>
  );
}

function describeEnvironment(replacing: AppSummary | undefined): string {
  if (replacing === undefined) {
    return 'What the binary runs with.';
  }
  return 'What the binary runs with. A value already set can be replaced but never read back, and a row removed here is a variable the app stops running with.';
}
