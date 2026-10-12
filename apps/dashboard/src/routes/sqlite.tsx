import { Toaster } from '@repo/ui/components/sonner';
import { createFileRoute } from '@tanstack/react-router';
import { SqliteBrowser } from '#components/sqlite/sqlite-browser.tsx';

export type SqliteSearch = { url: string; appId: string; path: string };

export const Route = createFileRoute('/sqlite')({
  validateSearch: (search: Record<string, unknown>): SqliteSearch => ({
    url: typeof search.url === 'string' ? search.url : '',
    appId: typeof search.appId === 'string' ? search.appId : '',
    path: typeof search.path === 'string' ? search.path : '',
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <SqliteBrowser />
      <Toaster />
    </>
  );
}
