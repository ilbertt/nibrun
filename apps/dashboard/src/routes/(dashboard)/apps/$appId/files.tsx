import { GUEST_PATH_ROOT } from '@repo/app-operations';
import { Button } from '@repo/ui/components/button';
import { createFileRoute } from '@tanstack/react-router';
import { SettingsIcon } from 'lucide-react';
import { PaidBucketRequestDialog } from '#components/apps/paid-bucket-request-dialog.tsx';
import { DirectoryBrowser } from '#components/files/directory-browser.tsx';

export type DirectorySearch = { path: string };

export const Route = createFileRoute('/(dashboard)/apps/$appId/files')({
  validateSearch: (search: Record<string, unknown>): DirectorySearch => ({
    path: typeof search.path === 'string' && search.path !== '' ? search.path : GUEST_PATH_ROOT,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">Files</h2>
        <PaidBucketRequestDialog
          trigger={
            <Button variant="outline" size="icon-sm" aria-label="Volume settings">
              <SettingsIcon />
            </Button>
          }
        />
      </div>
      <DirectoryBrowser />
    </div>
  );
}
