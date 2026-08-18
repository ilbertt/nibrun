import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@repo/ui/components/accordion';
import { Button } from '@repo/ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Textarea } from '@repo/ui/components/textarea';
import { DeployBinaryField } from '#components/apps/deploy-binary-field.tsx';
import { DeployEnvironmentField } from '#components/apps/deploy-environment-field.tsx';
import { DeployNameField } from '#components/apps/deploy-name-field.tsx';
import { useDeployForm, validatePort } from '#lib/hooks/use-deploy-form.ts';

export function DeployForm({ appId }: { appId: string | undefined }) {
  const { api, locked, replacing, targetResolved, defaultPort, defaultArgs } = useDeployForm({
    appId,
  });

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void api.handleSubmit();
      }}
    >
      <DeployBinaryField api={api} />

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

      <Accordion>
        <AccordionItem>
          <AccordionTrigger>
            Advanced settings
            {/* Collapsed, a refused variable would disable the button with nothing on screen
                saying why, so the section that holds it says so itself. */}
            <api.Subscribe selector={(state) => state.fieldMeta.environment?.errors.length ?? 0}>
              {(refused) =>
                refused > 0 ? (
                  <span className="font-normal text-destructive">needs a look</span>
                ) : null
              }
            </api.Subscribe>
          </AccordionTrigger>
          <AccordionContent>
            <DeployEnvironmentField api={api} replacing={replacing} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {replacing !== undefined && (
        <p className="wrap-anywhere rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
          This replaces the binary <span className="font-medium font-mono">{replacing.slug}</span>{' '}
          is running. Its hostnames and everything on its volume stay as they are.
        </p>
      )}

      <api.Subscribe selector={(state) => state.canSubmit}>
        {(canSubmit) => (
          <Button type="submit" size="lg" disabled={!canSubmit || !targetResolved}>
            <span className="truncate">{submitLabel({ replacing: replacing?.slug, locked })}</span>
          </Button>
        )}
      </api.Subscribe>
    </form>
  );
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
