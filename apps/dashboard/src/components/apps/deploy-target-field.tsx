import { Field, FieldDescription, FieldLabel } from '#components/ui/field.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select.tsx';
import type { DeployFormApi } from '#lib/hooks/use-deploy-form.ts';
import type { AppSummary } from '#queries/apps.ts';

const NEW_APP = 'A new app';

export function DeployTargetField({
  api,
  choices,
}: {
  api: DeployFormApi;
  choices: readonly AppSummary[];
}) {
  const options = [
    { value: null, label: NEW_APP },
    ...choices.map((app) => ({ value: app.slug, label: app.slug })),
  ];

  return (
    <api.Field name="target">
      {(field) => (
        <Field>
          <FieldLabel htmlFor="deploy-target">App</FieldLabel>
          <Select<string | null>
            value={field.state.value}
            onValueChange={(value) => field.handleChange(value)}
            items={options}
          >
            <SelectTrigger id="deploy-target" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.label} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Deploying onto an app you already have replaces the binary it runs.
          </FieldDescription>
        </Field>
      )}
    </api.Field>
  );
}
