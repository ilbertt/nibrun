import { Button } from '@repo/ui/components/button';
import { Spinner } from '@repo/ui/components/spinner';
import { RotateCcwIcon } from 'lucide-react';
import { useAddDomain } from '#lib/hooks/use-app-domains.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

/**
 * Asks the edge to validate the domain now rather than when its own schedule next comes round.
 * It is the same request that added the domain, said again — which is what the api makes of a
 * domain the app already holds — so nothing on the page changes until the edge answers, and the
 * hook says so in a toast.
 *
 * Words rather than a glyph: an arrow reads as reloading what is on screen, and this is a request
 * to Cloudflare.
 */
export function RetryValidationButton({ hostname }: { hostname: string }) {
  const again = useAddDomain(useAppId());

  return (
    <Button
      variant="outline"
      size="xs"
      disabled={again.isPending}
      onClick={() => again.mutate(hostname)}
    >
      {again.isPending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <RotateCcwIcon data-icon="inline-start" />
      )}
      Retry validation
    </Button>
  );
}
