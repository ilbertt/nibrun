import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppSidebar } from '#components/app-sidebar/app-sidebar.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { SidebarInset, SidebarProvider } from '#components/ui/sidebar.tsx';
import { Toaster } from '#components/ui/sonner.tsx';

export const Route = createFileRoute('/(dashboard)')({ component: RouteComponent });

function RouteComponent() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <Outlet />
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}
