import { Field, FieldError, FieldLabel } from '@repo/ui/components/field';
import { BINARY_INPUT_ID } from '#components/deploy/binary-drop-zone.tsx';
import { BinarySourcePicker } from '#components/deploy/binary-source-picker.tsx';
import {
  type DeployFormState,
  validateBinary,
  validateKeptBinary,
} from '#lib/hooks/use-deploy-form.ts';

export function DeployBinaryField({ form }: { form: DeployFormState }) {
  const { api, binaryListeners, locked } = form;
  // Whether a binary is required is asked of the form at mount, and answered again only when the
  // field changes — so it is read off the app this deploy targets rather than off the summary of
  // it, which arrives later and would leave a field the owner can fill refusing to be left empty.
  const validate = locked ? validateKeptBinary : validateBinary;

  return (
    <api.Field
      name="binary"
      validators={{ onMount: validate, onChange: validate }}
      listeners={binaryListeners}
    >
      {(field) => {
        const rejected = field.state.value !== undefined && field.state.meta.errors.length > 0;
        return (
          <Field data-invalid={rejected || undefined}>
            <FieldLabel htmlFor={BINARY_INPUT_ID}>Binary</FieldLabel>
            <BinarySourcePicker
              value={field.state.value}
              invalid={rejected}
              keeping={locked}
              onChange={field.handleChange}
            />
            {rejected && <FieldError>{field.state.meta.errors[0]}</FieldError>}
          </Field>
        );
      }}
    </api.Field>
  );
}
