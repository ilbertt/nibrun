import { Toaster } from '@repo/ui/components/sonner';
import { createFileRoute } from '@tanstack/react-router';
import { SqliteBrowser } from '#components/sqlite/sqlite-browser.tsx';

export const Route = createFileRoute('/sqlite/$appId/')({
  validateSearch: (search: Record<string, unknown>): { url: string } => ({
    url: typeof search.url === 'string' ? search.url : '',
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
