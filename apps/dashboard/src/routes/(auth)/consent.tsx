import { createFileRoute } from '@tanstack/react-router';
import { AuthCard } from '#components/auth/auth-card.tsx';
import { ConsentApproval } from '#components/consent/consent-approval.tsx';
import { signedQuery } from '#lib/oauth.ts';

const SCOPE_SEPARATOR = ' ';

/**
 * No `validateSearch`, unlike every other route here, and deliberately: better-auth signs the
 * authorize request with repeated `ba_param` keys, and the router's search parser collapses
 * repeated keys into one array-valued entry. What is answered has to be the query as it was
 * signed, so this page reads the location and leaves the router out of it.
 */
export const Route = createFileRoute('/(auth)/consent')({ component: RouteComponent });

function RouteComponent() {
  const asked = new URLSearchParams(signedQuery());
  const clientId = asked.get('client_id');

  if (!clientId) {
    return (
      <AuthCard
        failed
        title="Authorization failed"
        description="This link is missing the application it was asking about. Start again from the application."
      />
    );
  }

  return (
    <ConsentApproval
      clientId={clientId}
      scopes={asked.get('scope')?.split(SCOPE_SEPARATOR).filter(Boolean) ?? []}
    />
  );
}
