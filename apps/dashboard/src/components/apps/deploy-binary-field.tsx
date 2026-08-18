import { Field, FieldDescription, FieldError, FieldLabel } from '@repo/ui/components/field';
import { BINARY_INPUT_ID, BinaryDropZone } from '#components/apps/binary-drop-zone.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import { type DeployFormApi, validateBinary } from '#lib/hooks/use-deploy-form.ts';

export function DeployBinaryField({ api }: { api: DeployFormApi }) {
  return (
    <api.Field name="binary" validators={{ onMount: validateBinary, onChange: validateBinary }}>
      {(field) => {
        const rejected = field.state.value !== undefined && field.state.meta.errors.length > 0;
        return (
          <Field data-invalid={rejected || undefined}>
            <FieldLabel htmlFor={BINARY_INPUT_ID}>Binary</FieldLabel>
            <BinaryDropZone
              binary={field.state.value}
              invalid={rejected}
              onPick={field.handleChange}
            />
            {rejected ? (
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            ) : (
              <FieldDescription>{describeBinary(field.state.value)}</FieldDescription>
            )}
          </Field>
        );
      }}
    </api.Field>
  );
}

function describeBinary(binary: File | undefined): string {
  return binary === undefined
    ? 'The compiled binary to run in the guest.'
    : `${formatBytes(binary.size)}, uploaded straight to the store.`;
}
