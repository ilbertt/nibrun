import { HostnameSchema, Value } from '@repo/protocol';
import { Button } from '@repo/ui/components/button';
import { Field, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Spinner } from '@repo/ui/components/spinner';
import { revalidateLogic, useForm } from '@tanstack/react-form';
import { useAddDomain } from '#lib/hooks/use-app-domains.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function AddDomainForm() {
  const addition = useAddDomain(useAppId());

  // Nearly every prefix of a domain is malformed, so validating as it is typed would refuse the
  // owner from the first keystroke. Checked on submit instead, and from then on as they type.
  const api = useForm({
    defaultValues: { hostname: '' },
    validationLogic: revalidateLogic(),
    onSubmit: ({ value, formApi }) => {
      addition.mutate(value.hostname.trim(), { onSuccess: () => formApi.reset() });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void api.handleSubmit();
      }}
    >
      <api.Field name="hostname" validators={{ onDynamic: validateHostname }}>
        {(field) => {
          // The api's refusal reads as a field error too: it is about this hostname, and there is
          // nowhere else on the form for it to go.
          const refused = field.state.meta.errors[0] ?? addition.error?.message;
          return (
            <Field data-invalid={refused !== undefined || undefined}>
              <FieldLabel htmlFor="hostname">Add a domain</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="hostname"
                  value={field.state.value}
                  placeholder="app.example.com"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <Button
                  type="submit"
                  disabled={field.state.value.trim() === '' || addition.isPending}
                >
                  {addition.isPending ? <Spinner /> : 'Add'}
                </Button>
              </div>
              {refused === undefined ? null : <FieldError>{refused}</FieldError>}
            </Field>
          );
        }}
      </api.Field>
    </form>
  );
}

function validateHostname({ value }: { value: string }): string | undefined {
  return Value.Check(HostnameSchema, value.trim())
    ? undefined
    : 'A domain looks like app.example.com.';
}
