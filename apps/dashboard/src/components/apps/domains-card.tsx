import { isCloudflareAccessHeader } from '@repo/api-constants';
import { CLOUDFLARE_ACCESS_REMOVAL_HINT } from '@repo/app-ui';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { AddDomainForm } from '#components/apps/add-domain-form.tsx';
import { DomainRow } from '#components/apps/domain-row.tsx';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDeployments } from '#lib/hooks/use-deployments.ts';

export function DomainsCard() {
  const appId = useAppId();
  const app = useApp(appId).data;
  const latest = useDeployments(appId).data?.[0];
  const keepLastDomain =
    app?.hostnames.filter((h) => h.kind === 'custom').length === 1 &&
    [app.config.access, latest?.config.access].some(
      (access) => access?.kind === 'jwt' && isCloudflareAccessHeader(access.token.header),
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domains</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        <ul className="flex flex-col gap-4">
          {app?.hostnames.map((hostname) => (
            <DomainRow
              key={hostname.hostname}
              hostname={hostname}
              removalBlocked={keepLastDomain}
            />
          ))}
        </ul>
        {keepLastDomain && (
          <p id="last-domain-access" className="text-muted-foreground">
            {CLOUDFLARE_ACCESS_REMOVAL_HINT}
          </p>
        )}
        <AddDomainForm />
      </CardContent>
    </Card>
  );
}
