import { Field, FieldError, FieldLabel } from '@repo/ui/components/field';
import { BINARY_INPUT_ID } from '#components/apps/binary-drop-zone.tsx';
import { BinarySourcePicker } from '#components/apps/binary-source-picker.tsx';
import {
  type DeployFormApi,
  validateBinary,
  validateKeptBinary,
} from '#lib/hooks/use-deploy-form.ts';
import type { AppSummary } from '#queries/apps.ts';

export function DeployBinaryField({
  api,
  replacing,
}: {
  api: DeployFormApi;
  replacing: AppSummary | undefined;
}) {
  const validate = replacing === undefined ? validateBinary : validateKeptBinary;

  return (
    <api.Field name="binary" validators={{ onMount: validate, onChange: validate }}>
      {(field) => {
        const rejected = field.state.value !== undefined && field.state.meta.errors.length > 0;
        return (
          <Field data-invalid={rejected || undefined}>
            <FieldLabel htmlFor={BINARY_INPUT_ID}>Binary</FieldLabel>
            <BinarySourcePicker
              value={field.state.value}
              invalid={rejected}
              keeping={replacing !== undefined}
              onChange={field.handleChange}
            />
            {rejected && <FieldError>{field.state.meta.errors[0]}</FieldError>}
          </Field>
        );
      }}
    </api.Field>
  );
}
