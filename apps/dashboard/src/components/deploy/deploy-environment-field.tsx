import { Field, FieldError } from '@repo/ui/components/field';
import { EnvironmentTable } from '#components/apps/environment-table.tsx';
import { EnvFilePicker } from '#components/deploy/env-file-picker.tsx';
import { storedVariables, withEntries } from '#lib/environment-variables.ts';
import { type DeployFormApi, validateEnvironment } from '#lib/hooks/use-deploy-form.ts';
import type { AppSummary } from '#queries/apps.ts';

export function DeployEnvironmentField({
  api,
  replacing,
}: {
  api: DeployFormApi;
  replacing: AppSummary | undefined;
}) {
  return (
    <api.Field
      name="environment"
      // At mount as well as on change: a table a link seeded is one nobody has touched, and what
      // it holds still has to be something a release could be made of.
      validators={{ onChange: validateEnvironment, onMount: validateEnvironment }}
    >
      {(field) => {
        // Seeded from the app rather than held as a default: the app is read while the dialog is
        // already open, and a form's defaults are fixed when it mounts.
        const variables = field.state.value ?? storedVariables(replacing);

        return (
          <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
            <EnvironmentTable variables={variables} onChange={field.handleChange}>
              {replacing === undefined && (
                <EnvFilePicker
                  onLoad={(entries) => field.handleChange(withEntries({ variables, entries }))}
                />
              )}
            </EnvironmentTable>
            {field.state.meta.errors.length > 0 && (
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            )}
          </Field>
        );
      }}
    </api.Field>
  );
}
