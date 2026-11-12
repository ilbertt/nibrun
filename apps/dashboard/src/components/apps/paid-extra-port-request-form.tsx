import { Button } from '@repo/ui/components/button';
import { FieldError } from '@repo/ui/components/field';
import { Spinner } from '@repo/ui/components/spinner';
import { usePaidExtraPortRequest } from '#lib/hooks/use-paid-extra-port-request.ts';

export function PaidExtraPortRequestForm() {
  const form = usePaidExtraPortRequest();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      {form.saved ? (
        <p role="status">Thanks! We recorded your request for an extra public port for this app.</p>
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
