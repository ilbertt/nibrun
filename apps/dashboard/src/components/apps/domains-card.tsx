import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { AddDomainForm } from '#components/apps/add-domain-form.tsx';
import { DomainRow } from '#components/apps/domain-row.tsx';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function DomainsCard() {
  const app = useApp(useAppId());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domains</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        <ul className="flex flex-col gap-4">
          {app.data?.hostnames.map((hostname) => (
            <DomainRow key={hostname.hostname} hostname={hostname} />
          ))}
        </ul>
        <AddDomainForm />
      </CardContent>
    </Card>
  );
}
