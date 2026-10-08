import { Toaster } from '@repo/ui/components/sonner';
import { createFileRoute } from '@tanstack/react-router';
import { SqliteBrowser } from '#components/sqlite/sqlite-browser.tsx';

export const Route = createFileRoute('/sqlite')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { url: string; appId: string | undefined } => ({
    url: typeof search.url === 'string' ? search.url : '',
    appId: typeof search.appId === 'string' ? search.appId : undefined,
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
