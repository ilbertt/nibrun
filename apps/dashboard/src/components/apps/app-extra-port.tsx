import { Button } from '@repo/ui/components/button';
import { Network } from 'lucide-react';
import { AppPublicPortAddress } from '#components/apps/app-public-port-address.tsx';
import { PaidExtraPortRequestDialog } from '#components/apps/paid-extra-port-request-dialog.tsx';
import type { AppSummary } from '#queries/apps.ts';

export function AppExtraPort({ app }: { app: AppSummary }) {
  if (app.config.hasExtraPublicPort) {
    return <AppPublicPortAddress appId={app.id} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Extra TCP/UDP port</span>
        <PaidExtraPortRequestDialog
          trigger={
            <Button variant="outline" size="xs">
              <Network data-icon="inline-start" />
              Request extra port
            </Button>
          }
        />
      </div>
    </div>
  );
}
