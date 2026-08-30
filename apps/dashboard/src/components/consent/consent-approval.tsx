import { Button } from '@repo/ui/components/button';
import { Field, FieldError } from '@repo/ui/components/field';
import { AuthCard } from '#components/auth/auth-card.tsx';
import { ConsentScopes } from '#components/consent/consent-scopes.tsx';
import { useConsentDecision } from '#lib/hooks/use-consent-decision.ts';
import { useOauthClient } from '#lib/hooks/use-oauth-client.ts';
import { useSession } from '#lib/hooks/use-session.ts';

export function ConsentApproval({ clientId, scopes }: { clientId: string; scopes: string[] }) {
  const session = useSession();
  const client = useOauthClient(clientId);
  const decide = useConsentDecision();

  if (client.status === 'checking') {
    return <AuthCard title="Authorize an application" description="Checking that application…" />;
  }

  if (client.status === 'refused') {
    return <AuthCard failed title="Authorization failed" description={client.reason} />;
  }

  return (
    <AuthCard
      title="Authorize an application"
      description="Allow only if you just started this yourself."
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">
            <span className="font-semibold text-foreground">{client.name}</span> is asking to act as
          </p>
          <p className="truncate font-semibold">{session?.user.email}</p>
        </div>
        <ConsentScopes scopes={scopes} />
        <p className="text-muted-foreground text-sm">
          Anyone can register an application, and this one named itself. Allow it only if you
          recognise it — what it is granted, it can do without asking you again.
        </p>
        <Field data-invalid={decide.isError || undefined}>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              disabled={decide.isPending}
              onClick={() => decide.mutate('refuse')}
            >
              Refuse
            </Button>
            <Button
              className="flex-1"
              disabled={decide.isPending}
              onClick={() => decide.mutate('allow')}
            >
              {decide.isPending ? 'Working…' : 'Allow'}
            </Button>
          </div>
          {decide.isError && <FieldError>{decide.error.message}</FieldError>}
        </Field>
      </div>
    </AuthCard>
  );
}
