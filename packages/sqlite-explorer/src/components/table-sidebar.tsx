import { cn } from '@repo/ui/lib/utils';
import { CodeXmlIcon, TableIcon } from 'lucide-react';
import type { useSqliteExplorer } from '#hooks/use-sqlite-explorer.ts';

export function TableSidebar({
  tables,
  running,
  view,
  resultTable,
  openSqlEditor,
  openTable,
}: Pick<
  ReturnType<typeof useSqliteExplorer>,
  'tables' | 'running' | 'view' | 'resultTable' | 'openSqlEditor' | 'openTable'
>) {
  return (
    <aside
      aria-label="Database tables"
      className="flex max-h-40 shrink-0 flex-col overflow-auto border-border/20 border-b md:max-h-none md:w-60 md:border-r md:border-b-0"
    >
      <button
        type="button"
        disabled={running}
        onClick={openSqlEditor}
        aria-current={view === 'sql' ? 'true' : undefined}
        className={cn(
          'flex items-center gap-2 border-border/20 border-b px-4 py-3 text-left text-sm hover:bg-muted disabled:opacity-50',
          view === 'sql' && 'bg-muted font-medium',
        )}
      >
        <CodeXmlIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        SQL editor
      </button>
      <h2 className="px-4 pt-4 pb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
        Tables and views
      </h2>
      {tables.map((table) => (
        <button
          key={String(table.name)}
          type="button"
          disabled={running}
          onClick={() => openTable(String(table.name))}
          aria-current={view === 'table' && resultTable === table.name ? 'true' : undefined}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted disabled:opacity-50',
            view === 'table' && resultTable === table.name && 'bg-muted font-medium',
          )}
        >
          <TableIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{String(table.name)}</span>
        </button>
      ))}
      {tables.length === 0 ? (
        <p className="px-4 py-3 text-muted-foreground text-sm">No tables or views.</p>
      ) : null}
    </aside>
  );
}
