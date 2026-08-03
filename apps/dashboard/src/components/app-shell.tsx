import type { ReactNode } from 'react';
import { AppSidebar } from '#components/app-sidebar/app-sidebar.tsx';
import { SiteHeader } from '#components/site-header.tsx';
import { SidebarInset, SidebarProvider } from '#components/ui/sidebar.tsx';
import { useSession } from '#lib/hooks/use-session.ts';

// Signing in is the one route the guard lets through without a session, and it
// is also the one route that must not be framed by the dashboard chrome.
export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();

  if (!session) {
    return children;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
