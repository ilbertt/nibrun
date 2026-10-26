import { Button } from '@repo/ui/components/button';
import { FieldError } from '@repo/ui/components/field';
import { Spinner } from '@repo/ui/components/spinner';
import { usePaidBucketRequest } from '#lib/hooks/use-paid-bucket-request.ts';

export function PaidBucketRequestForm() {
  const form = usePaidBucketRequest();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      {form.saved ? (
        <p role="status">Thanks! We recorded your request to use your own bucket.</p>
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
