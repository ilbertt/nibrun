import { RefreshCwIcon } from 'lucide-react';
import { Button } from '#components/ui/button.tsx';
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
