import { Toaster } from '@repo/ui/components/sonner';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { SiteHeader } from '#components/site-header.tsx';

export const Route = createFileRoute('/(dashboard)')({ component: RouteComponent });

function RouteComponent() {
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background">
      <SiteHeader />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
