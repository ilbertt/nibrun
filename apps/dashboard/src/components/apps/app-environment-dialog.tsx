import { AppEnvironmentDialogContent } from '#components/apps/app-environment-dialog-content.tsx';
import { DeployRunProvider } from '#lib/providers/deploy-run-provider.tsx';
import type { AppSummary } from '#queries/apps.ts';

export function AppEnvironmentDialog({ app }: { app: AppSummary }) {
  return (
    <DeployRunProvider>
      <AppEnvironmentDialogContent app={app} />
    </DeployRunProvider>
  );
}
