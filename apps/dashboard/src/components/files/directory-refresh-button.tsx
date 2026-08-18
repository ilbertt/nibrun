import { Button } from '@repo/ui/components/button';
import { RefreshCwIcon } from 'lucide-react';
import { useDirectoryRefresh } from '#lib/hooks/use-directory-refresh.ts';

export function DirectoryRefreshButton() {
  const { isRefreshing, refresh } = useDirectoryRefresh();

  return (
    <Button
      aria-label="Refresh this directory"
      disabled={isRefreshing}
      onClick={refresh}
      size="icon-sm"
      variant="outline"
    >
      <RefreshCwIcon className={isRefreshing ? 'animate-spin' : undefined} />
    </Button>
  );
}
