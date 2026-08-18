import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppActions } from '#components/apps/app-actions.tsx';
import { AppTabs } from '#components/apps/app-tabs.tsx';
import { AppTitle } from '#components/apps/app-title.tsx';

export const Route = createFileRoute('/(dashboard)/apps/$appId')({ component: RouteComponent });

function RouteComponent() {
  return (
    <div className="@container/main flex h-full flex-col gap-4 p-4 md:gap-6 md:p-6">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AppTitle />
          <AppActions />
        </div>
        <AppTabs />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
