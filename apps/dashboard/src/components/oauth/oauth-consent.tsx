import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { Field, FieldError } from '@repo/ui/components/field';
import { OAuthConsentButtons } from '#components/oauth/oauth-consent-buttons.tsx';
import { OAuthPermissions } from '#components/oauth/oauth-permissions.tsx';
import { useOAuthConsent } from '#lib/hooks/use-oauth-consent.ts';
import { useOAuthConsentDecision } from '#lib/hooks/use-oauth-consent-decision.ts';
import { useSession } from '#lib/hooks/use-session.ts';

export function OAuthConsent() {
  const consent = useOAuthConsent();
  const decision = useOAuthConsentDecision();
  const session = useSession();

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Connect to nibrun</CardTitle>
        <CardDescription>
          {consent.isPending
            ? 'Checking the connection request…'
            : consent.isError
              ? consent.error.message
              : `${consent.data.client.client_name ?? 'An app'} wants to access your account.`}
        </CardDescription>
      </CardHeader>
      {consent.isSuccess && (
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">Connecting as</p>
            <p className="truncate font-semibold">{session?.user.email}</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-sm">App identifier</p>
            <p className="wrap-anywhere text-sm">{consent.data.client.client_id}</p>
          </div>
          <OAuthPermissions scopes={consent.data.scopes} />
          <p className="text-muted-foreground text-sm">
            Continue only if you started this connection and trust this app.
          </p>
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
