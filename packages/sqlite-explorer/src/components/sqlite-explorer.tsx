import { cn } from '@repo/ui/lib/utils';
import { ConnectionForm } from '#components/connection-form.tsx';
import { ExplorerHeader } from '#components/explorer-header.tsx';
import { QueryResults } from '#components/query-results.tsx';
import { ResultsHeader } from '#components/results-header.tsx';
import { SqlEditor } from '#components/sql-editor.tsx';
import { TableSidebar } from '#components/table-sidebar.tsx';
import { useSqliteExplorer } from '#hooks/use-sqlite-explorer.ts';
export function SqliteExplorer({ className }: { className: string | undefined }) {
  const explorer = useSqliteExplorer();

  if (!explorer.connection) {
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
    <section
      className={cn(
        'sqlite-explorer flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/20 bg-background',
        className,
      )}
    >
      <ExplorerHeader url={explorer.connection.url} disconnect={explorer.disconnect} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <TableSidebar
          tables={explorer.tables}
          running={explorer.running}
          view={explorer.view}
          resultTable={explorer.resultTable}
          openSqlEditor={explorer.openSqlEditor}
          openTable={explorer.openTable}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {explorer.view === 'sql' ? (
            <SqlEditor
              query={explorer.query}
              setQuery={explorer.setQuery}
              run={explorer.run}
              running={explorer.running}
            />
          ) : null}
          {explorer.error ? (
            <p
              role="alert"
              className="border-border/20 border-y bg-destructive/5 px-4 py-3 text-destructive text-sm"
            >
              {explorer.error}
            </p>
          ) : null}
          <div className="flex min-h-0 flex-[2] flex-col border-border/20 border-t">
            <ResultsHeader
              view={explorer.view}
              resultTable={explorer.resultTable}
              running={explorer.running}
              canGoBack={explorer.canGoBack}
              goBack={explorer.goBack}
              canLoadPreviousQuery={explorer.canLoadPreviousQuery}
              loadPreviousQuery={explorer.loadPreviousQuery}
            />
            <div className="min-h-0 flex-1">
              {explorer.result ? (
                <QueryResults
                  key={explorer.resultQuery}
                  result={explorer.result}
                  running={explorer.running}
                  loadPage={explorer.loadPage}
                  references={explorer.references}
                  followReference={explorer.followReference}
                />
              ) : (
                <p className="p-8 text-center text-muted-foreground text-sm">
                  {explorer.view === 'sql'
                    ? 'Run a query to see results.'
                    : 'Select a table or open the SQL editor.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
