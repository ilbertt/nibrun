import { Button } from '@repo/ui/components/button';
import { ArrowLeftIcon, ClockIcon } from 'lucide-react';
import type { useSqliteExplorer } from '#hooks/use-sqlite-explorer.ts';

export function ResultsHeader({
  view,
  resultTable,
  running,
  canGoBack,
  goBack,
  canLoadPreviousQuery,
  loadPreviousQuery,
}: Pick<
  ReturnType<typeof useSqliteExplorer>,
  | 'view'
  | 'resultTable'
  | 'running'
  | 'canGoBack'
  | 'goBack'
  | 'canLoadPreviousQuery'
  | 'loadPreviousQuery'
>) {
  return (
    <div className="flex items-center gap-3 border-border/20 border-b px-4 py-2 text-muted-foreground text-xs">
      {view === 'sql' ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={running || !canLoadPreviousQuery}
          onClick={loadPreviousQuery}
        >
          <ClockIcon aria-hidden="true" />
          Previous query
        </Button>
      ) : canGoBack ? (
        <Button variant="ghost" size="xs" disabled={running} onClick={goBack}>
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </Button>
      ) : null}
      <span>{view === 'table' ? (resultTable ?? 'Tables') : 'Query results'}</span>
    </div>
  );
}
