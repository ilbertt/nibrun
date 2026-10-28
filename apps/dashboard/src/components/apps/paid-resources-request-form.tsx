import { MAX_PAID_RESOURCE_AMOUNT } from '@repo/api-constants';
import { Button } from '@repo/ui/components/button';
import { Field, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Spinner } from '@repo/ui/components/spinner';
import { useId } from 'react';
import { usePaidResourcesRequest } from '#lib/hooks/use-paid-resources-request.ts';
import { PAID_RESOURCE_LABELS, type PaidResourceValues } from '#lib/paid-resources-request.ts';

export function PaidResourcesRequestForm() {
  const form = usePaidResourcesRequest();
  const inputId = useId();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      <p className="text-muted-foreground text-sm">
        Enter how much to add to this app’s current resources. Use 0 to leave a resource unchanged.
        Request an increase for at least one resource.
      </p>
      {Object.entries(PAID_RESOURCE_LABELS).map(([name, label]) => {
        const resource = name as keyof PaidResourceValues;
        const id = `${inputId}-${resource}`;
        return (
          <Field key={resource}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_PAID_RESOURCE_AMOUNT}
              step={1}
              required
              value={form.values[resource]}
              onChange={(event) => form.change({ resource, value: event.target.value })}
              disabled={form.pending}
            />
          </Field>
        );
      })}
      <Button type="submit" disabled={!form.submittable}>
        {form.pending && <Spinner />}
        Send request
      </Button>
      {form.savedAmounts !== undefined && (
        <p role="status" className="text-sm">
          Thanks! We recorded your request for +{form.savedAmounts.additionalVcpuCount} vCPUs, +
          {form.savedAmounts.additionalMemoryMib} MiB RAM, and +
          {form.savedAmounts.additionalVolumeGib} GiB volume for this app.
        </p>
      )}
      {form.error !== undefined && <FieldError role="alert">{form.error}</FieldError>}
    </form>
  );
}
