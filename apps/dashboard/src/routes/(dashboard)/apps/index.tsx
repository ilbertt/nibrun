import { createFileRoute } from '@tanstack/react-router';
import { AppsList } from '#components/apps/apps-list.tsx';
import { DeployDialog } from '#components/apps/deploy-dialog.tsx';
import { useApps } from '#lib/hooks/use-apps.ts';

export const Route = createFileRoute('/(dashboard)/apps/')({ component: RouteComponent });

function RouteComponent() {
  const apps = useApps();
  const noApps = apps.data?.length === 0;

  return (
    <div className="@container/main flex flex-col gap-4 p-4 md:gap-6 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-medium text-base">Apps</h1>
        {/* The empty state puts its own Deploy button in the middle of the page. */}
        {noApps ? null : <DeployDialog />}
      </div>
      <AppsList />
    </div>
  );
}
