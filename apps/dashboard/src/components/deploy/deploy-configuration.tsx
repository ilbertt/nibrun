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
import { DeployEnvironmentField } from '#components/deploy/deploy-environment-field.tsx';
import { DeployNameField } from '#components/deploy/deploy-name-field.tsx';
import type { DeploySuggestion } from '#lib/deploy-link.ts';
import {
  type EnvironmentVariable,
  filledVariables,
  storedVariables,
  unfilledAsked,
} from '#lib/environment-variables.ts';
import { type DeployFormState, tenantArguments, validatePort } from '#lib/hooks/use-deploy-form.ts';

const ARGUMENTS = 'Arguments';
const ADDITIONAL_PORTS = 'Additional ports';
const ENVIRONMENT = 'environment';

const AWAITING = 'Fill these in.';

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
            {field.state.meta.errors.length > 0 && (
              <FieldError>{field.state.meta.errors[0]}</FieldError>
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
                  <FieldDescription>One per line.</FieldDescription>
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
            <api.Subscribe
              selector={(state) =>
                environmentMark({
                  variables: state.values.environment,
                  refused: (state.fieldMeta.environment?.errors.length ?? 0) > 0,
                })
              }
            >
              {(mark) => <EnvironmentMark mark={mark} />}
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

/**
 * Whether the link named a variable it carried no value for. Such a link cannot deploy on its own,
 * whatever it asked to show: the owner is the only one who has the value.
 */
export function asksForVariables(suggested: DeploySuggestion | undefined): boolean {
  return suggested?.environment?.some((entry) => entry.value.length === 0) ?? false;
}

type EnvironmentMarkKind = 'awaiting' | 'refused' | undefined;

/**
 * A link asks for the variables only the owner holds, and the form waits on them. That is not a
 * mistake, so the section is marked rather than told off — and it outranks anything else the
 * table has to say, which is what lets the mark stand for whichever issue the field is showing.
 */
function environmentMark({
  variables,
  refused,
}: {
  variables: EnvironmentVariable[] | undefined;
  refused: boolean;
}): EnvironmentMarkKind {
  if (unfilledAsked(variables ?? []).length > 0) {
    return 'awaiting';
  }
  return refused ? 'refused' : undefined;
}

function EnvironmentMark({ mark }: { mark: EnvironmentMarkKind }) {
  if (mark === 'refused') {
    return <span className="font-normal text-destructive">needs a look</span>;
  }
  if (mark === 'awaiting') {
    return (
      <span className="flex h-5 shrink-0 items-center" title={AWAITING}>
        <span className="size-1.5 rounded-full bg-warning motion-safe:animate-pulse" />
        <span className="sr-only">{AWAITING}</span>
      </span>
    );
  }
  return null;
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
