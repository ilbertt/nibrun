import { createFileRoute, Outlet } from '@tanstack/react-router';
import { SiteHeader } from '#components/site-header.tsx';
import { Toaster } from '#components/ui/sonner.tsx';

export const Route = createFileRoute('/(dashboard)')({ component: RouteComponent });

function RouteComponent() {
  return (
    <div className="flex min-h-svh w-full flex-col bg-background">
      <SiteHeader />
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
