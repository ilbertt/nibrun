import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { Field, FieldError } from '@repo/ui/components/field';
import { OAuthClientIdentity } from '#components/oauth/oauth-client-identity.tsx';
import { OAuthConsentButtons } from '#components/oauth/oauth-consent-buttons.tsx';
import { useMcpConsentAnalytics } from '#lib/hooks/use-mcp-consent-analytics.ts';
import { useOAuthConsent } from '#lib/hooks/use-oauth-consent.ts';
import { useOAuthConsentDecision } from '#lib/hooks/use-oauth-consent-decision.ts';
import { useSession } from '#lib/hooks/use-session.ts';

export function OAuthConsent() {
  const consent = useOAuthConsent();
  const decision = useOAuthConsentDecision();
  const session = useSession();
  useMcpConsentAnalytics({ ready: consent.isSuccess, error: consent.error });

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Connect to nibrun</CardTitle>
        {!consent.isSuccess && (
          <CardDescription>
            {consent.isError ? consent.error.message : 'Checking the connection request…'}
          </CardDescription>
        )}
      </CardHeader>
      {consent.isSuccess && (
        <CardContent className="flex flex-col gap-6">
          <OAuthClientIdentity />
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">Connecting as</p>
            <p className="truncate font-semibold">{session?.user.email}</p>
          </div>
          <Field data-invalid={decision.isError || undefined}>
            <OAuthConsentButtons
              redirecting={decision.isPending || decision.isSuccess}
              onDecide={decision.mutate}
            />
            {decision.isError && <FieldError>{decision.error.message}</FieldError>}
          </Field>
        </CardContent>
      )}
    </Card>
  );
}
