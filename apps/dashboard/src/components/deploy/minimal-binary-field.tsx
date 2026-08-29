import { Field, FieldError } from '@repo/ui/components/field';
import { BinaryDropTarget } from '@repo/ui/custom/binary-drop-target';
import { FileTerminalIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { BINARY_INPUT_ID } from '#components/deploy/binary-drop-zone.tsx';
import { fetchedUrl, namedByUrl, pickedFile } from '#lib/binary-source.ts';
import { type DeployFormApi, validateBinary } from '#lib/hooks/use-deploy-form.ts';

/**
 * The binary, asked for the way the landing page asks: a link carries everything else, so the one
 * thing left to do is the only thing on screen.
 *
 * Unless the link carried that too, in which case there is nothing left to do and nothing to ask
 * for — the binary is named rather than dropped, and the button below is the whole of it.
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
        const fetching = file === undefined ? fetchedUrl(field.state.value) : undefined;
        return (
          <Field data-invalid={rejected || undefined}>
            {fetching === undefined ? (
              <BinaryDropTarget
                inputId={BINARY_INPUT_ID}
                binary={file}
                title={invitation(appName)}
                invalid={rejected}
                onPick={field.handleChange}
              />
            ) : (
              <FetchedBinary url={fetching} />
            )}
            {rejected && <FieldError>{field.state.meta.errors[0]}</FieldError>}
          </Field>
        );
      }}
    </api.Field>
  );
}

/** What the link named, in the place a drop target would have been asking for it. */
function FetchedBinary({ url }: { url: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-muted-foreground/25 bg-input/40 px-6 py-16 text-center sm:py-20">
      <FileTerminalIcon className="size-8 text-muted-foreground" />
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="font-medium text-lg sm:text-xl">
          Deploy <span className="font-mono font-semibold">{namedByUrl(url) ?? 'the binary'}</span>
        </span>
        <span className="wrap-anywhere font-mono text-muted-foreground text-xs">{url}</span>
      </span>
    </div>
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
