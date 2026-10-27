import { Button } from '@repo/ui/components/button';
import { FieldError } from '@repo/ui/components/field';
import { Spinner } from '@repo/ui/components/spinner';
import { usePaidAlwaysOnRequest } from '#lib/hooks/use-paid-always-on-request.ts';

export function PaidAlwaysOnRequestForm() {
  const form = usePaidAlwaysOnRequest();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      {form.saved ? (
        <p role="status">Thanks! We recorded your request to keep this app always on.</p>
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
