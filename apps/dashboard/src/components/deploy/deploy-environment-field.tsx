import { Field, FieldError } from '@repo/ui/components/field';
import { EnvironmentTable } from '#components/apps/environment-table.tsx';
import { EnvFilePicker } from '#components/deploy/env-file-picker.tsx';
import { storedVariables, unfilledAsked, withEntries } from '#lib/environment-variables.ts';
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
        const [issue] = field.state.meta.errors;
        // The one thing the form stops for that nobody got wrong: the value is the owner's to
        // give, so it is asked for in its own colour rather than reported in the colour of a
        // mistake. Checked first by the validator, so this is the issue whenever there is one.
        const awaiting = unfilledAsked(variables).length > 0;

        return (
          <Field data-invalid={(issue !== undefined && !awaiting) || undefined}>
            <EnvironmentTable variables={variables} onChange={field.handleChange}>
              {replacing === undefined && (
                <EnvFilePicker
                  onLoad={(entries) => field.handleChange(withEntries({ variables, entries }))}
                />
              )}
            </EnvironmentTable>
            {issue !== undefined &&
              (awaiting ? (
                <p role="status" className="text-sm text-warning">
                  {issue}
                </p>
              ) : (
                <FieldError>{issue}</FieldError>
              ))}
          </Field>
        );
      }}
    </api.Field>
  );
}
