import { createFileRoute } from '@tanstack/react-router';
import { PreviewDashboard } from '#components/preview-dashboard.tsx';
import { pageHead } from '#lib/page-head.ts';

/**
 * Temporary: the dashboard's app page, rebuilt here so a styling direction can be looked at on a
 * preview deployment without a session. Delete once the direction is settled — the real page is
 * `apps/dashboard`, and nothing here is wired to anything.
 *
 * Full width with a bar across the top, because that is the shape of the real thing: the dashboard
 * has no reading measure to sit inside the way the rest of this site does.
 */
export const Route = createFileRoute('/dashboard')({
  head: () =>
    pageHead({
      path: '/dashboard',
      title: 'Styling preview',
      description: 'A styling preview of the dashboard. Not a real page.',
    }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex min-h-svh w-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center border-b-2">
        <div className="flex w-full items-center gap-3 px-4 lg:px-6">
          <span className="font-heading font-medium">nibrun</span>
          <nav className="text-muted-foreground text-sm">Apps</nav>
          <span className="ml-auto flex items-center gap-2 font-mono text-muted-foreground text-xs">
            <span className="size-1.5 rounded-full bg-primary" />
            all systems go
          </span>
        </div>
      </header>
      <main className="flex w-full flex-col gap-4 p-4 md:gap-6 md:p-6">
        <p className="w-fit border-2 border-warning border-dashed px-3 py-1.5 text-muted-foreground text-xs">
          Styling preview. Nothing here is connected — the real page lives in the dashboard.
        </p>
        <PreviewDashboard />
      </main>
    </div>
  );
}
