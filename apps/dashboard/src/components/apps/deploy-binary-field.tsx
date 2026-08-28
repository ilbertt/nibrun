import { Field, FieldDescription, FieldError, FieldLabel } from '@repo/ui/components/field';
import { BINARY_INPUT_ID, BinaryDropZone } from '#components/apps/binary-drop-zone.tsx';
import { BinaryUrlBox } from '#components/apps/binary-url-box.tsx';
import { type BinarySource, fetchedUrl, pickedFile, sourceFromUrl } from '#lib/binary-source.ts';
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
        const url = fetchedUrl(field.state.value);
        return (
          <Field data-invalid={rejected || undefined}>
            <FieldLabel htmlFor={BINARY_INPUT_ID}>Binary</FieldLabel>
            {/* Side by side, because they are two answers to one question rather than a choice to
                make first. Setting either is what empties the other: a deploy has one binary. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <BinaryDropZone
                binary={pickedFile(field.state.value)}
                invalid={rejected && url === undefined}
                keeping={replacing !== undefined}
                onPick={field.handleChange}
              />
              <BinaryUrlBox
                url={url ?? ''}
                invalid={rejected && url !== undefined}
                onType={(typed) => field.handleChange(sourceFromUrl(typed))}
              />
            </div>
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
  binary: BinarySource | undefined;
  replacing: AppSummary | undefined;
}): string {
  const file = pickedFile(binary);
  if (file !== undefined) {
    return `${formatBytes(file.size)}, uploaded straight to the store.`;
  }
  if (fetchedUrl(binary) !== undefined) {
    return 'Fetched by nibrun when you deploy, so nothing crosses this browser.';
  }
  return replacing === undefined
    ? 'The compiled binary to run in the guest.'
    : 'Leave it empty and the app runs the binary it already has, with what you change here.';
}
