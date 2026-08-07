import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppBreadcrumb } from '#components/apps/app-breadcrumb.tsx';
import { AppTabs } from '#components/apps/app-tabs.tsx';

export const Route = createFileRoute('/(dashboard)/apps/$appId')({ component: RouteComponent });

function RouteComponent() {
  return (
    <div className="@container/main flex min-h-0 flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <div className="flex flex-col gap-3">
        <AppBreadcrumb />
        <AppTabs />
      </div>
      <Outlet />
    </div>
  );
}
