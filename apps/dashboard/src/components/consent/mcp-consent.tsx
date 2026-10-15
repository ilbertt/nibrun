import { Button } from '@repo/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { Field, FieldError } from '@repo/ui/components/field';
import { useMcpConsent } from '#lib/hooks/use-mcp-consent.ts';

export function McpConsent() {
  const consent = useMcpConsent();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect to nibrun</CardTitle>
        <CardDescription>
          {consent.loading
            ? 'Checking authorization…'
            : consent.unavailable
              ? 'This authorization request is unavailable. Start connecting again from your MCP client.'
              : `${consent.clientName} wants access to your nibrun account.`}
        </CardDescription>
      </CardHeader>
      {!consent.loading && !consent.unavailable && (
        <CardContent className="flex flex-col gap-6">
          <p className="text-muted-foreground text-sm">
            Allow this client to manage your apps, deployments, and data, including deleting them.
            It can keep access while you are away. Approve only if you trust this client and started
            this connection.
          </p>
          <Field data-invalid={consent.failed || undefined}>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                disabled={consent.pending}
                onClick={() => consent.decide(false)}
              >
                Refuse
              </Button>
              <Button
                className="flex-1"
                disabled={consent.pending}
                onClick={() => consent.decide(true)}
              >
                {consent.pending ? 'Working…' : 'Allow access'}
              </Button>
            </div>
            {consent.failed && (
              <FieldError>Could not complete authorization. Please try again.</FieldError>
            )}
          </Field>
        </CardContent>
      )}
    </Card>
  );
}
