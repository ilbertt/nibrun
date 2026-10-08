import { SqliteExplorer, useSqliteExplorer } from '@repo/sqlite-explorer';
import { cn } from '@repo/ui/lib/utils';
import { ConnectionForm } from '#components/sqlite-studio/connection-form.tsx';
import { ExplorerHeader } from '#components/sqlite-studio/explorer-header.tsx';

export function SqliteStudioPreview({ className }: { className: string | undefined }) {
  const explorer = useSqliteExplorer();
  if (!explorer.workspace) {
    return (
      <div className={className}>
        <ConnectionForm
          connecting={explorer.connecting}
          error={explorer.error}
          connect={explorer.connect}
        />
      </div>
    );
  }
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <ExplorerHeader url={explorer.workspace.url} disconnect={explorer.disconnect} />
      <SqliteExplorer
        workspace={explorer.workspace}
        className="min-h-0 flex-1 rounded-t-none border-t-0"
      />
    </div>
  );
}
