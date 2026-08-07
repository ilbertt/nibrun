import { GUEST_PATH_ROOT } from '@repo/protocol';
import { createFileRoute } from '@tanstack/react-router';
import { DirectoryBrowser } from '#components/files/directory-browser.tsx';

export type DirectorySearch = { path: string };

export const Route = createFileRoute('/(dashboard)/apps/$appId/files')({
  validateSearch: (search: Record<string, unknown>): DirectorySearch => ({
    path: typeof search.path === 'string' && search.path !== '' ? search.path : GUEST_PATH_ROOT,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <DirectoryBrowser />;
}
