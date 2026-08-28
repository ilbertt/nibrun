import { EXTRA_PUBLIC_PORT_VALUES, RUNTIME_VALUES, writtenRuntimeValue } from '@repo/protocol';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@repo/ui/components/accordion';
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
import { DeployEnvironmentField } from '#components/apps/deploy-environment-field.tsx';
import { DeployNameField } from '#components/apps/deploy-name-field.tsx';
import { type DeploySuggestion, namesVariables } from '#lib/deploy-link.ts';
import { filledVariables, storedVariables } from '#lib/environment-variables.ts';
import { type DeployFormState, tenantArguments, validatePort } from '#lib/hooks/use-deploy-form.ts';

const ARGUMENTS = 'Arguments';
const ADDITIONAL_PORTS = 'Additional ports';
const ENVIRONMENT = 'environment';

/** Everything a deploy is beyond the binary itself, which is everything a link can carry. */
export function DeployConfiguration({
  form,
  suggested,
}: {
  form: DeployFormState;
  suggested: DeploySuggestion | undefined;
}) {
  const { api, locked, replacing, defaultPort, defaultExtraPublicPort, defaultArgs } = form;

  return (
    <>
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

      {/* Open where a link named a variable at all: the owner is the only one who holds a value it
          could not carry, and a shut section is no way to ask them for it — nor to say what a
          value it did carry is about to make the app run with. */}
      <Accordion defaultValue={namesVariables(suggested) ? [ENVIRONMENT] : []}>
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
    </>
  );
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
