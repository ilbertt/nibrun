import { Field, FieldError } from '@repo/ui/components/field';
import { BinaryDropTarget } from '@repo/ui/custom/binary-drop-target';
import type { ReactNode } from 'react';
import { BINARY_INPUT_ID } from '#components/apps/binary-drop-zone.tsx';
import { fetchedUrl, namedByUrl, pickedFile } from '#lib/binary-source.ts';
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
        const file = pickedFile(field.state.value);
        // A link that carried the binary leaves nothing to drop, so the target says what will be
        // fetched instead of asking — and stays a target, because dropping one is how you deploy
        // something else.
        const fetching = file === undefined ? fetchedUrl(field.state.value) : undefined;
        return (
          <Field data-invalid={rejected || undefined}>
            <BinaryDropTarget
              inputId={BINARY_INPUT_ID}
              binary={file}
              title={fetching === undefined ? invitation(appName) : fetches(fetching)}
              caption={fetching === undefined ? undefined : 'nibrun fetches it, or drop your own'}
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

function fetches(url: string): ReactNode {
  return (
    <>
      Deploy <span className="font-mono font-semibold">{namedByUrl(url) ?? 'the binary'}</span>
    </>
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
