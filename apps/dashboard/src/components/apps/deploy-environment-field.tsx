import { Field, FieldDescription, FieldError, FieldTitle } from '@repo/ui/components/field';
import { EnvFilePicker } from '#components/apps/env-file-picker.tsx';
import { EnvironmentTable } from '#components/apps/environment-table.tsx';
import { storedVariables, withEntries } from '#lib/environment-variables.ts';
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
      {(field) => {
        // Seeded from the app rather than held as a default: the app is read while the dialog is
        // already open, and a form's defaults are fixed when it mounts.
        const variables = field.state.value ?? storedVariables(replacing);

        return (
          <Field
            aria-labelledby={TITLE_ID}
            data-invalid={field.state.meta.errors.length > 0 || undefined}
          >
            <FieldTitle id={TITLE_ID}>Environment</FieldTitle>
            <EnvironmentTable variables={variables} onChange={field.handleChange}>
              {replacing === undefined && (
                <EnvFilePicker
                  onLoad={(entries) => field.handleChange(withEntries({ variables, entries }))}
                />
              )}
            </EnvironmentTable>
            {field.state.meta.errors.length > 0 ? (
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            ) : (
              <FieldDescription>{describeEnvironment(replacing)}</FieldDescription>
            )}
          </Field>
        );
      }}
    </api.Field>
  );
}

function describeEnvironment(replacing: AppSummary | undefined): string {
  if (replacing === undefined) {
    return 'What the binary runs with.';
  }
  return 'What the binary runs with. A value already set can be replaced, and a row removed here is a variable the app stops running with.';
}
