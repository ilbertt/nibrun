import { createFileRoute } from '@tanstack/react-router';
import { AppsList } from '#components/apps/apps-list.tsx';
import { DeployDialog } from '#components/apps/deploy-dialog.tsx';

export const Route = createFileRoute('/(dashboard)/apps/')({ component: RouteComponent });

function RouteComponent() {
  return (
    <div className="@container/main flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <div className="flex justify-end">
        <DeployDialog />
      </div>
      <AppsList />
    </div>
  );
}
