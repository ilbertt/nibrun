import { Field, FieldDescription, FieldLabel } from '#components/ui/field.tsx';
import { Input } from '#components/ui/input.tsx';
import type { DeployFormApi } from '#lib/hooks/use-deploy-form.ts';

export function DeployNameField({ api }: { api: DeployFormApi }) {
  return (
    <api.Subscribe selector={(state) => state.values.binary?.name}>
      {(binaryName) => (
        <api.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="deploy-name">Name</FieldLabel>
              <Input
                id="deploy-name"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={binaryName ?? 'Named after the binary'}
                autoComplete="off"
              />
              <FieldDescription>
                The hostname is derived from this once, and never again.
              </FieldDescription>
            </Field>
          )}
        </api.Field>
      )}
    </api.Subscribe>
  );
}
