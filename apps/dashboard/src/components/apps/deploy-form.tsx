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
import { useStore } from '@tanstack/react-form';
import { DeployBinaryField } from '#components/apps/deploy-binary-field.tsx';
import { DeployEnvironmentField } from '#components/apps/deploy-environment-field.tsx';
import { DeployNameField } from '#components/apps/deploy-name-field.tsx';
import { filledVariables, storedVariables } from '#lib/environment-variables.ts';
import {
  type DeploySuggestion,
  tenantArguments,
  useDeployForm,
  validatePort,
} from '#lib/hooks/use-deploy-form.ts';

const ARGUMENTS = 'Arguments';

export function DeployForm({
  appId,
  binary,
  suggested,
}: {
  appId: string | undefined;
  binary: File | undefined;
  suggested?: DeploySuggestion | undefined;
}) {
  const { api, locked, replacing, targetResolved, defaultPort, defaultArgs } = useDeployForm({
    appId,
    binary,
    suggested,
  });
  const picked = useStore(api.store, (state) => state.values.binary !== undefined);

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void api.handleSubmit();
      }}
    >
      <DeployBinaryField api={api} replacing={replacing} />

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

      <Accordion>
        <AccordionItem>
          <AccordionTrigger>
            <span className="flex items-baseline gap-2">
              {ARGUMENTS}
              <api.Subscribe
                selector={(state) => tenantArguments(state.values.args ?? defaultArgs).length}
              >
                {(count) => <CollapsedCount count={count} />}
              </api.Subscribe>
            </span>
          </AccordionTrigger>
          <AccordionContent keepMounted>
            <api.Field name="args">
              {(field) => (
                <Field>
                  <Textarea
                    aria-label={ARGUMENTS}
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
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Accordion>
        <AccordionItem>
          <AccordionTrigger>
            <span className="flex items-baseline gap-2">
              Environment variables
              <api.Subscribe
                selector={(state) =>
                  filledVariables(state.values.environment ?? storedVariables(replacing)).length
                }
              >
                {(count) => <CollapsedCount count={count} />}
              </api.Subscribe>
            </span>
            {/* Collapsed, a refused variable would disable the button with nothing on screen
                saying why, so the section that holds it says so itself. A shut panel keeps its
                variables validated, which is what leaves anything to say. */}
            <api.Subscribe selector={(state) => state.fieldMeta.environment?.errors.length ?? 0}>
              {(refused) =>
                refused > 0 ? (
                  <span className="font-normal text-destructive">needs a look</span>
                ) : null
              }
            </api.Subscribe>
          </AccordionTrigger>
          <AccordionContent keepMounted>
            <DeployEnvironmentField api={api} replacing={replacing} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {replacing !== undefined && (
        <p className="wrap-anywhere rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
          This restarts <span className="font-medium font-mono">{replacing.slug}</span>
          {picked ? ' on the binary above' : ' on the binary it already runs'}. Its hostnames and
          everything on its volume stay as they are.
        </p>
      )}

      <api.Subscribe selector={(state) => state.canSubmit}>
        {(canSubmit) => (
          <Button type="submit" size="lg" disabled={!canSubmit || !targetResolved}>
            <span className="truncate">
              {submitLabel({ replacing: replacing?.slug, locked, picked })}
            </span>
          </Button>
        )}
      </api.Subscribe>
    </form>
  );
}

/** What the section holds, for as long as it is closed over it. */
function CollapsedCount({ count }: { count: number }) {
  return (
    <span className="font-normal text-muted-foreground text-xs group-aria-expanded/accordion-trigger:hidden">
      {count === 0 ? 'none' : count}
    </span>
  );
}

function submitLabel({
  replacing,
  locked,
  picked,
}: {
  replacing: string | undefined;
  locked: boolean;
  picked: boolean;
}): string {
  if (replacing !== undefined) {
    return picked ? `Replace what ${replacing} runs` : `Redeploy ${replacing}`;
  }
  return locked ? 'Reading the app…' : 'Create the app and deploy';
}
