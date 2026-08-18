import { createFileRoute } from '@tanstack/react-router';
import { AppsList } from '#components/apps/apps-list.tsx';
import { DeployDialog } from '#components/apps/deploy-dialog.tsx';

export const Route = createFileRoute('/(dashboard)/apps/')({ component: RouteComponent });

function RouteComponent() {
  return (
    <div className="@container/main flex flex-col gap-4 p-4 md:gap-6 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-medium text-base">Apps</h1>
        <DeployDialog />
      </div>
      <AppsList />
    </div>
  );
}
