import { DEFAULT_APP_ACCESS } from '@repo/api-constants';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@repo/ui/components/accordion';
import { Field, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Textarea } from '@repo/ui/components/textarea';
import { CheckIcon, GlobeIcon, KeyRoundIcon } from 'lucide-react';
import { CloudflareIcon } from '#icons/cloudflare-icon.tsx';
import {
  type AccessFields,
  type AccessMode,
  type AppAccess,
  accessFields,
  accessModeLabel,
  parseAccess,
} from '#lib/app-access-form.ts';
import type { DeployFormApi } from '#lib/hooks/use-deploy-form.ts';

type AccessEdit = Partial<AccessFields>;
const MODES = [
  { value: 'public', icon: GlobeIcon },
  { value: 'cloudflare', icon: CloudflareIcon },
  { value: 'jwt', icon: KeyRoundIcon },
] as const;

export function DeployAccessField({
  api,
  saved,
}: {
  api: DeployFormApi;
  saved: AppAccess | undefined;
}) {
  return (
    <api.Field
      name="access"
      validators={{ onChange: ({ value }) => value && parseAccess(value).error }}
    >
      {(field) => {
        const fields = field.state.value ?? accessFields(saved ?? DEFAULT_APP_ACCESS);
        const error = field.state.meta.errors[0];
        function change(patch: AccessEdit) {
          field.handleChange({ ...fields, ...patch });
        }
        return (
          <Accordion>
            <AccordionItem>
              <AccordionTrigger>
                <span className="flex items-baseline gap-2">
                  HTTP access
                  <span className="text-muted-foreground text-xs">
                    {accessModeLabel(fields.mode)}
                  </span>
                </span>
                {error && <span className="text-destructive text-xs">Check settings</span>}
              </AccordionTrigger>
              <AccordionContent keepMounted>
                <div className="grid gap-4">
                  <AccessPicker mode={fields.mode} change={(mode) => change({ mode })} />
                  {fields.mode === 'cloudflare' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        label="Team domain"
                        id="cf-team"
                        value={fields.team}
                        placeholder="acme.cloudflareaccess.com"
                        change={(team) => change({ team })}
                      />
                      <TextField
                        label="Application audience (AUD)"
                        id="cf-aud"
                        value={fields.cloudflareAudience}
                        placeholder="Application AUD tag"
                        change={(cloudflareAudience) => change({ cloudflareAudience })}
                      />
                    </div>
                  )}
                  {fields.mode === 'cloudflare' && (
                    <p className="text-muted-foreground text-sm">
                      If your app exposes an MCP server, enable{' '}
                      <a
                        className="underline underline-offset-4"
                        href="https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Managed OAuth
                      </a>{' '}
                      in your Cloudflare Access application.
                    </p>
                  )}
                  {fields.mode === 'jwt' && <JwtFields fields={fields} change={change} />}

                  {error && <FieldError role="alert">{error}</FieldError>}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        );
      }}
    </api.Field>
  );
}

function AccessPicker({ mode, change }: { mode: AccessMode; change: (mode: AccessMode) => void }) {
  return (
    <fieldset className="grid grid-cols-3 gap-2">
      <legend className="sr-only">Access method</legend>
      {MODES.map(({ value, icon: Icon }) => (
        <label
          key={value}
          className="relative flex min-h-16 cursor-pointer flex-col items-start justify-center gap-1.5 rounded-lg border border-border px-3 font-medium text-sm hover:bg-muted/50 has-checked:border-foreground has-checked:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring"
        >
          <input
            className="sr-only"
            type="radio"
            name="access-mode"
            value={value}
            checked={value === mode}
            onChange={() => change(value)}
          />
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          {accessModeLabel(value)}
          {value === mode && (
            <CheckIcon aria-hidden="true" className="absolute top-2 right-2 size-3.5" />
          )}
        </label>
      ))}
    </fieldset>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  change,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  change: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        className="font-mono text-sm"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(event) => change(event.target.value)}
      />
    </Field>
  );
}

function JwtFields({
  fields,
  change,
}: {
  fields: AccessFields;
  change: (patch: AccessEdit) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="jwt-issuer"
          label="Issuer"
          placeholder="https://identity.example.com"
          value={fields.issuer}
          change={(issuer) => change({ issuer })}
        />
        <TextField
          id="jwt-jwks"
          label="JWKS URL"
          placeholder="https://identity.example.com/keys"
          value={fields.jwksUrl}
          change={(jwksUrl) => change({ jwksUrl })}
        />
      </div>
      <Field>
        <FieldLabel htmlFor="jwt-audiences">Audiences · one per line</FieldLabel>
        <Textarea
          id="jwt-audiences"
          className="min-h-14 font-mono text-sm"
          value={fields.audiences}
          placeholder="reports-api"
          onChange={(event) => change({ audiences: event.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          id="jwt-header"
          label="Token header"
          value={fields.header}
          placeholder="Authorization"
          change={(header) => change({ header })}
        />
        <Field>
          <FieldLabel htmlFor="jwt-format">Token format</FieldLabel>
          <select
            id="jwt-format"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={fields.format}
            onChange={(event) =>
              change({ format: event.target.value === 'raw' ? 'raw' : 'bearer' })
            }
          >
            <option value="bearer">Bearer</option>
            <option value="raw">Raw</option>
          </select>
        </Field>
      </div>
    </div>
  );
}
