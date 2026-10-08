import type { QueryResult } from '@libredb/studio/types';

export function ResultStats({ result, offset }: { result: QueryResult; offset: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-border/20 border-b px-4 py-2 text-muted-foreground text-xs">
      <div className="flex items-center gap-4">
        <span>
          {result.rows.length} {result.rows.length === 1 ? 'row' : 'rows'}
        </span>
        <span>
          {result.fields.length} {result.fields.length === 1 ? 'column' : 'columns'}
        </span>
        <span>{Math.round(result.executionTime)} ms</span>
      </div>
      {result.rows.length > 0 ? (
        <span>
          Rows {offset + 1}–{offset + result.rows.length}
        </span>
      ) : null}
    </div>
  );
}
