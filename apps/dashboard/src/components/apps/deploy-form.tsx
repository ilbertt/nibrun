import { EXTRA_PUBLIC_PORT_VALUES, RUNTIME_VALUES, writtenRuntimeValue } from '@repo/protocol';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@repo/ui/components/accordion';
import { Button } from '@repo/ui/components/button';
import { Checkbox } from '@repo/ui/components/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Textarea } from '@repo/ui/components/textarea';
import { useStore } from '@tanstack/react-form';
import { DeployBinaryField } from '#components/apps/deploy-binary-field.tsx';
import { DeployEnvironmentField } from '#components/apps/deploy-environment-field.tsx';
import { DeployNameField } from '#components/apps/deploy-name-field.tsx';
import type { DeploySuggestion } from '#lib/deploy-link.ts';
import { filledVariables, storedVariables } from '#lib/environment-variables.ts';
import { tenantArguments, useDeployForm, validatePort } from '#lib/hooks/use-deploy-form.ts';

const ARGUMENTS = 'Arguments';
const ADDITIONAL_PORTS = 'Additional ports';
const ENVIRONMENT = 'environment';

export function DeployForm({
  appId,
  binary,
  suggested,
}: {
  appId: string | undefined;
  binary: File | undefined;
  suggested?: DeploySuggestion | undefined;
}) {
  const {
    api,
    locked,
    replacing,
    targetResolved,
    defaultPort,
    defaultExtraPublicPort,
    defaultArgs,
  } = useDeployForm({
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
            <FieldLabel htmlFor="deploy-port">HTTP port</FieldLabel>
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
              {ADDITIONAL_PORTS}
              <api.Subscribe
                selector={(state) => state.values.extraPublicPort ?? defaultExtraPublicPort}
              >
                {(asked) => <CollapsedState on={asked} />}
              </api.Subscribe>
            </span>
          </AccordionTrigger>
          <AccordionContent keepMounted>
            <api.Field name="extraPublicPort">
              {(field) => (
                <Field orientation="horizontal">
                  <Checkbox
                    id="deploy-extra-public-port"
                    checked={field.state.value ?? defaultExtraPublicPort}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="deploy-extra-public-port">
                      Give this app a public port besides HTTPS
                    </FieldLabel>
                    <FieldDescription>
                      One port, TCP and UDP, for a protocol HTTPS cannot carry — WebRTC media, a
                      game server, anything that has to be reached directly.
                    </FieldDescription>
                    <FieldDescription>
                      You do not pick the number. nibrun assigns it and sets these for the app:
                    </FieldDescription>
                    <ul className="list-disc space-y-1 pt-2 pb-3 pl-4 text-muted-foreground text-sm">
                      {EXTRA_PUBLIC_PORT_VALUES.map(({ name, description }) => (
                        <li key={name}>
                          <code className="font-mono">{name}</code> — {description}
                        </li>
                      ))}
                    </ul>
                    <FieldDescription>
                      Your own variables may name them — set{' '}
                      <code className="font-mono">
                        ANNOUNCED_IP={writtenRuntimeValue(RUNTIME_VALUES.PUBLIC_IPV4.name)}
                      </code>{' '}
                      and the app reads it under the name it already expects.
                    </FieldDescription>
                    <FieldDescription>
                      Free for now, and likely to become part of a paid plan later.
                    </FieldDescription>
                  </FieldContent>
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

      {/* Open where a link asked for a variable it could not carry: the owner is the only one who
          holds the value, and a shut section is no way to ask them for it. */}
      <Accordion defaultValue={asksForVariables(suggested) ? [ENVIRONMENT] : []}>
        <AccordionItem value={ENVIRONMENT}>
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

function asksForVariables(suggested: DeploySuggestion | undefined): boolean {
  return suggested?.environment?.some((entry) => entry.value.length === 0) ?? false;
}

/** What the section says while it is shut, in the one word a count would be. */
function CollapsedState({ on }: { on: boolean }) {
  return (
    <span className="font-normal text-muted-foreground text-xs group-aria-expanded/accordion-trigger:hidden">
      {on ? 'one' : 'none'}
    </span>
  );
}

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
