import { Field, FieldDescription, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import type { ImageSource } from '#lib/app-source.ts';

export function ImageSourceFields({
  value,
  invalid,
  onChange,
}: {
  value: ImageSource;
  invalid: boolean;
  onChange: (source: ImageSource) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="deploy-image-reference">Image reference</FieldLabel>
        <Input
          id="deploy-image-reference"
          value={value.reference}
          onChange={(event) => onChange({ ...value, reference: event.target.value })}
          placeholder="docker.io/library/my-app@sha256:…"
          aria-invalid={invalid}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
        <FieldDescription>Public Linux amd64 image, pinned by digest.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="deploy-image-program">Program</FieldLabel>
        <Input
          id="deploy-image-program"
          value={value.program}
          onChange={(event) => onChange({ ...value, program: event.target.value })}
          placeholder="/usr/local/bin/server"
          aria-invalid={invalid}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="deploy-image-directory">Working directory</FieldLabel>
        <Input
          id="deploy-image-directory"
          value={value.workingDirectory}
          onChange={(event) => onChange({ ...value, workingDirectory: event.target.value })}
          aria-invalid={invalid}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
        <FieldDescription>
          Set startup paths, arguments and environment explicitly. The app runs as an unprivileged
          user.
        </FieldDescription>
      </Field>
    </div>
  );
}
