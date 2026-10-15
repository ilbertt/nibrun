import { Button } from '@repo/ui/components/button';

export function OAuthConsentButtons({
  redirecting,
  onDecide,
}: {
  redirecting: boolean;
  onDecide: (accept: boolean) => void;
}) {
  return (
    <div className="flex gap-3">
      <Button
        variant="outline"
        className="flex-1"
        disabled={redirecting}
        onClick={() => onDecide(false)}
      >
        Deny
      </Button>
      <Button className="flex-1" disabled={redirecting} onClick={() => onDecide(true)}>
        {redirecting ? 'Redirecting…' : 'Allow access'}
      </Button>
    </div>
  );
}
