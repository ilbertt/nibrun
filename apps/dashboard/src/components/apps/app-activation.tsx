import { activationSummary } from '@repo/app-operations';
import { Button } from '@repo/ui/components/button';
import { Zap } from 'lucide-react';
import { PaidAlwaysOnRequestDialog } from '#components/apps/paid-always-on-request-dialog.tsx';
import type { AppSummary } from '#queries/apps.ts';

export function AppActivation({ app }: { app: AppSummary }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Activation</span>
        {app.activation === 'on-request' ? (
          <PaidAlwaysOnRequestDialog
            trigger={
              <Button variant="outline" size="xs">
                <Zap data-icon="inline-start" />
                Keep always on
              </Button>
            }
          />
        ) : (
          <span>{activationSummary(app)}</span>
        )}
      </div>
      {app.activation === 'on-request' && (
        <p className="text-muted-foreground text-xs">{activationSummary(app)}</p>
      )}
    </div>
  );
}
