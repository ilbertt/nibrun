import { MAX_PAID_PORTS_REQUEST, MIN_PAID_PORTS_REQUEST } from '@repo/api-constants';
import { Button } from '@repo/ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Spinner } from '@repo/ui/components/spinner';
import { useId } from 'react';
import { usePaidExtraPortRequest } from '#lib/hooks/use-paid-extra-port-request.ts';

export function PaidExtraPortRequestForm() {
  const form = usePaidExtraPortRequest();
  const inputId = useId();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      <Field>
        <FieldLabel htmlFor={inputId}>How many extra public ports do you need?</FieldLabel>
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={MIN_PAID_PORTS_REQUEST}
          max={MAX_PAID_PORTS_REQUEST}
          step={1}
          required
          value={form.value}
          onChange={(event) => form.change(event.target.value)}
          disabled={form.pending}
        />
        <FieldDescription>
          Enter the total number of extra ports you need for this app ({MIN_PAID_PORTS_REQUEST}–
          {MAX_PAID_PORTS_REQUEST}).
        </FieldDescription>
      </Field>
      <Button type="submit" disabled={!form.submittable}>
        {form.pending && <Spinner />}
        Send request
      </Button>
      {form.savedAmount !== undefined && (
        <p role="status">
          Thanks! We recorded your request for {form.savedAmount} extra public
          {form.savedAmount === 1 ? ' port' : ' ports'} for this app.
        </p>
      )}
      {form.error !== undefined && <FieldError role="alert">{form.error}</FieldError>}
    </form>
  );
}
