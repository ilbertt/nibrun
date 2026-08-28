import { Field, FieldError } from '@repo/ui/components/field';
import { BinaryDropTarget } from '@repo/ui/custom/binary-drop-target';
import type { ReactNode } from 'react';
import { BINARY_INPUT_ID } from '#components/apps/binary-drop-zone.tsx';
import { type DeployFormApi, validateBinary } from '#lib/hooks/use-deploy-form.ts';

/**
 * The binary, asked for the way the landing page asks: a link carries everything else, so the one
 * thing left to do is the only thing on screen.
 */
export function MinimalBinaryField({
  api,
  appName,
}: {
  api: DeployFormApi;
  appName: string | undefined;
}) {
  return (
    <api.Field name="binary" validators={{ onMount: validateBinary, onChange: validateBinary }}>
      {(field) => {
        const rejected = field.state.value !== undefined && field.state.meta.errors.length > 0;
        return (
          <Field data-invalid={rejected || undefined}>
            <BinaryDropTarget
              inputId={BINARY_INPUT_ID}
              binary={field.state.value}
              title={invitation(appName)}
              invalid={rejected}
              onPick={field.handleChange}
            />
            {rejected && <FieldError>{field.state.meta.errors[0]}</FieldError>}
          </Field>
        );
      }}
    </api.Field>
  );
}

// Whoever followed the link compiled one binary for one app, and the link knows which.
function invitation(appName: string | undefined): ReactNode {
  if (appName === undefined) {
    return 'Drop it here';
  }
  return (
    <>
      Drop the <span className="font-mono font-semibold">{appName}</span> binary here
    </>
  );
}
