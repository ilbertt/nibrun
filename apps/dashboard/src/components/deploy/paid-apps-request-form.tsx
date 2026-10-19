import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';
import { Button } from '@repo/ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Spinner } from '@repo/ui/components/spinner';
import { useId } from 'react';
import { usePaidAppsRequest } from '#lib/hooks/use-paid-apps-request.ts';

export function PaidAppsRequestForm() {
  const form = usePaidAppsRequest();
  const inputId = useId();
  const descriptionId = useId();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      <Field data-invalid={form.error !== undefined || undefined}>
        <FieldLabel htmlFor={inputId}>How many apps do you need in total?</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={MIN_PAID_APPS_REQUEST}
            max={MAX_PAID_APPS_REQUEST}
            step={1}
            required
            value={form.value}
            onChange={(event) => form.change(event.target.value)}
            disabled={form.pending}
            aria-describedby={descriptionId}
            className="w-24"
          />
          <Button type="submit" disabled={!form.submittable}>
            {form.pending && <Spinner />}
            Send request
          </Button>
        </div>
        <FieldDescription id={descriptionId}>
          Choose {MIN_PAID_APPS_REQUEST}–{MAX_PAID_APPS_REQUEST} apps. This records your interest;
          your current limit stays the same.
        </FieldDescription>
        {form.loadFailed && (
          <FieldDescription>
            Could not load your previous request. You can still send one.
          </FieldDescription>
        )}
        {form.error !== undefined && <FieldError role="alert">{form.error}</FieldError>}
      </Field>
      {form.savedAmount !== undefined && (
        <p role="status" className="text-sm">
          Thanks! We recorded your request for {form.savedAmount} app
          {form.savedAmount === 1 ? '' : 's'} in total. You can update it here anytime.
        </p>
      )}
    </form>
  );
}
