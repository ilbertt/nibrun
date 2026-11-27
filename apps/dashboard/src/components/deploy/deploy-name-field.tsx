import { Field, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { appSourceName } from '#lib/app-source.ts';
import type { DeployFormApi } from '#lib/hooks/use-deploy-form.ts';

export function DeployNameField({ api }: { api: DeployFormApi }) {
  return (
    <api.Subscribe selector={(state) => appSourceName(state.values.binary)}>
      {(named) => (
        <api.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="deploy-name">Name</FieldLabel>
              <Input
                id="deploy-name"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={named ?? 'Named after the app source'}
                autoComplete="off"
              />
            </Field>
          )}
        </api.Field>
      )}
    </api.Subscribe>
  );
}
