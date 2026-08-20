import { Field, FieldDescription, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Textarea } from '@repo/ui/components/textarea';
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
    <api.Field name="environment" validators={{ onChange: validateEnvironment }}>
      {(field) => (
        <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
          <FieldLabel htmlFor="deploy-environment">Environment</FieldLabel>
          <Textarea
            id="deploy-environment"
            value={field.state.value ?? ''}
            onChange={(event) => field.handleChange(event.target.value)}
            placeholder={'OPENCLAW_STATE_DIR=/app/data/.openclaw'}
            className="font-mono"
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

// A value cannot be shown once it is set — the api returns the names and nothing else — so what
// this says is what leaving the box alone will do.
function describeEnvironment(replacing: AppSummary | undefined): string {
  const names = Object.keys(replacing?.config.environment ?? {});
  if (names.length === 0) {
    return 'One NAME=value per line. What the binary runs with.';
  }
  return `One NAME=value per line. What is not named here is left as it is — ${names.join(', ')} are set.`;
}
