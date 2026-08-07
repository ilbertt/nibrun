import { DeployNameField } from '#components/apps/deploy-name-field.tsx';
import { Button } from '#components/ui/button.tsx';
import { Field, FieldDescription, FieldError, FieldLabel } from '#components/ui/field.tsx';
import { Input } from '#components/ui/input.tsx';
import { Textarea } from '#components/ui/textarea.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import { useDeployForm, validateBinary, validatePort } from '#lib/hooks/use-deploy-form.ts';

export function DeployForm({ appId }: { appId: string | undefined }) {
  const { api, locked, replacing, targetResolved, defaultPort, defaultArgs } = useDeployForm({
    appId,
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void api.handleSubmit();
      }}
    >
      <api.Field name="binary" validators={{ onMount: validateBinary, onChange: validateBinary }}>
        {(field) => {
          const rejected = field.state.value !== undefined && field.state.meta.errors.length > 0;
          return (
            <Field data-invalid={rejected || undefined}>
              <FieldLabel htmlFor="deploy-binary">Binary</FieldLabel>
              <Input
                id="deploy-binary"
                type="file"
                onChange={(event) => field.handleChange(event.target.files?.[0])}
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

      {!locked && <DeployNameField api={api} />}

      <api.Field name="port" validators={{ onChange: validatePort }}>
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
            <FieldLabel htmlFor="deploy-port">Guest port</FieldLabel>
            <Input
              id="deploy-port"
              value={field.state.value ?? defaultPort}
              onChange={(event) => field.handleChange(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              className="font-mono tabular-nums"
            />
            {field.state.meta.errors.length > 0 ? (
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            ) : (
              <FieldDescription>The port the binary listens on inside the guest.</FieldDescription>
            )}
          </Field>
        )}
      </api.Field>

      <api.Field name="args">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="deploy-args">Arguments</FieldLabel>
            <Textarea
              id="deploy-args"
              value={field.state.value ?? defaultArgs}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder={'serve\n--verbose'}
              className="font-mono"
            />
            <FieldDescription>
              One per line. What is here is what the binary runs with — empty runs it bare.
            </FieldDescription>
          </Field>
        )}
      </api.Field>

      {replacing !== undefined && (
        <p className="rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
          This replaces the binary <span className="font-medium font-mono">{replacing.slug}</span>{' '}
          is running. Its hostnames and everything on its volume stay as they are.
        </p>
      )}

      <api.Subscribe selector={(state) => state.canSubmit}>
        {(canSubmit) => (
          <Button type="submit" size="lg" disabled={!canSubmit || !targetResolved}>
            {submitLabel({ replacing: replacing?.slug, locked })}
          </Button>
        )}
      </api.Subscribe>
    </form>
  );
}

function describeBinary(binary: File | undefined): string {
  return binary === undefined
    ? 'The compiled binary to run in the guest.'
    : `${formatBytes(binary.size)}, uploaded straight to the store.`;
}

function submitLabel({
  replacing,
  locked,
}: {
  replacing: string | undefined;
  locked: boolean;
}): string {
  if (replacing !== undefined) {
    return `Replace what ${replacing} runs`;
  }
  return locked ? 'Reading the app…' : 'Create the app and deploy';
}
