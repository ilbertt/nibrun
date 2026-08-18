import { DIRECTORY_ENTRY_LIMIT } from '@repo/protocol';
import { Card } from '@repo/ui/components/card';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@repo/ui/components/empty';
import { Skeleton } from '@repo/ui/components/skeleton';
import { FolderOpenIcon } from 'lucide-react';
import { DeploymentLine } from '#components/apps/deployment-line.tsx';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { DirectoryRefreshButton } from '#components/files/directory-refresh-button.tsx';
import { DirectoryTable } from '#components/files/directory-table.tsx';
import { PathBreadcrumb } from '#components/files/path-breadcrumb.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryListing } from '#lib/hooks/use-directory-listing.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';

export function DirectoryBrowser() {
  const appId = useAppId();
  const typedPath = useDirectoryPath();
  const view = useDirectoryListing({ appId, typedPath });

  return (
    <div className="flex flex-col gap-4">
      {view.deploymentId !== undefined && <DeploymentLine deploymentId={view.deploymentId} />}
      <div className="flex items-center justify-between gap-4">
        <PathBreadcrumb />
        <DirectoryRefreshButton />
      </div>
      {view.status === 'failed' && (
        <FailureEmpty title="Could not read that directory" reason={view.reason ?? ''} />
      )}
      {view.status === 'loading' && <Skeleton className="h-48 w-full rounded-2xl" />}
      {view.listing !== undefined &&
        (view.listing.entries.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpenIcon />
              </EmptyMedia>
              <EmptyTitle>This directory is empty</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden p-0">
            <DirectoryTable entries={view.listing.entries} />
          </Card>
        ))}
      {view.listing?.truncated === true && (
        <p className="text-muted-foreground text-sm">
          Only the first {DIRECTORY_ENTRY_LIMIT} entries of {view.listing.path} are shown.
        </p>
      )}
    </div>
  );
}
