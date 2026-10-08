import { SqliteExplorer } from '@repo/sqlite-explorer';
import { Skeleton } from '@repo/ui/components/skeleton';
import { DatabaseIcon } from 'lucide-react';
import { FailureEmpty } from '#components/failure-empty.tsx';
import { useDashboardSqliteExplorer } from '#lib/hooks/use-dashboard-sqlite-explorer.ts';

export function SqliteBrowser() {
  const view = useDashboardSqliteExplorer();
  return (
    <main className="flex h-svh min-h-96 flex-col gap-3 bg-background p-4 md:p-6">
      <h1 className="flex items-center gap-2 font-medium">
        <DatabaseIcon className="size-4 text-muted-foreground" />
        <span className="truncate" title={view.path}>
          {view.fileName ?? 'SQLite explorer'}
        </span>
      </h1>
      {view.error !== undefined && (
        <FailureEmpty title="Could not open this database" reason={view.error} />
      )}
      {view.error === undefined && view.workspace === undefined && (
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
      )}
      {view.workspace !== undefined && view.error === undefined && (
        <SqliteExplorer workspace={view.workspace} className="min-h-0 flex-1" />
      )}
    </main>
  );
}
