import { Button } from '@repo/ui/components/button';
import { FieldError } from '@repo/ui/components/field';
import { Spinner } from '@repo/ui/components/spinner';
import { usePaidResourcesRequest } from '#lib/hooks/use-paid-resources-request.ts';

export function PaidResourcesRequestForm() {
  const form = usePaidResourcesRequest();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      {form.saved ? (
        <p role="status">
          Thanks! We recorded your request for more CPU, RAM, and volume for this app.
        </p>
      ) : (
        <Button type="submit" disabled={form.pending}>
          {form.pending && <Spinner />}
          Send request
        </Button>
      )}
      {form.error !== undefined && <FieldError role="alert">{form.error}</FieldError>}
    </form>
  );
}
