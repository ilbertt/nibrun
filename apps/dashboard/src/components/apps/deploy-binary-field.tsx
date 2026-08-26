import { Field, FieldDescription, FieldError, FieldLabel } from '@repo/ui/components/field';
import { BINARY_INPUT_ID, BinaryDropZone } from '#components/apps/binary-drop-zone.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
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
            <BinaryDropZone
              binary={field.state.value}
              invalid={rejected}
              keeping={replacing !== undefined}
              onPick={field.handleChange}
            />
            {rejected ? (
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            ) : (
              <FieldDescription>
                {describeBinary({ binary: field.state.value, replacing })}
              </FieldDescription>
            )}
          </Field>
        );
      }}
    </api.Field>
  );
}

function describeBinary({
  binary,
  replacing,
}: {
  binary: File | undefined;
  replacing: AppSummary | undefined;
}): string {
  if (binary !== undefined) {
    return `${formatBytes(binary.size)}, uploaded straight to the store.`;
  }
  return replacing === undefined
    ? 'The compiled binary to run in the guest.'
    : 'Leave it empty and the app runs the binary it already has, with what you change here.';
}
