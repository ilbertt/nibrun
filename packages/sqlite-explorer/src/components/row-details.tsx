import type { QueryResult } from '@libredb/studio/types';
import { Button } from '@repo/ui/components/button';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { ExternalLinkIcon } from 'lucide-react';
import { ValueCopyButton } from '#components/value-copy-button.tsx';
import type { SqliteRowReference } from '#lib/foreign-keys.ts';

export function RowDetails({
  row,
  number,
  fields,
  columnTypes,
  references,
  running,
  followReference,
}: {
  row: QueryResult['rows'][number];
  number: number;
  fields: QueryResult['fields'];
  columnTypes: QueryResult['columnTypes'];
  references: SqliteRowReference[];
  running: boolean;
  followReference: (reference: SqliteRowReference) => void;
}) {
  return (
    <DialogContent className="max-h-[80svh] w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Row {number}</DialogTitle>
      </DialogHeader>
      <dl className="min-h-0 divide-y divide-border/20 overflow-y-auto">
        {fields.map((field) => (
          <div
            key={field}
            className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] sm:gap-4"
          >
            <dt className="flex flex-wrap items-center gap-2 font-mono text-xs">
              {field}
              <span className="text-muted-foreground text-xs">{columnTypes?.[field]}</span>
            </dt>
            <dd className="flex min-w-0 items-start gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <details className="min-w-0">
                  <summary
                    className="sqlite-row-value rounded-sm font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring"
                    title="Click to expand or collapse value"
                  >
                    {row[field] === null ? (
                      <span className="text-muted-foreground italic">NULL</span>
                    ) : (
                      String(row[field] ?? '')
                    )}
                  </summary>
                </details>
                {references
                  .filter((reference) => reference.columnName === field)
                  .map((reference) => (
                    <Button
                      key={reference.sql}
                      variant="ghost"
                      size="xs"
                      className="shrink-0 text-muted-foreground"
                      title={`${reference.referencedTable}.${reference.referencedColumn}`}
                      aria-label={`View row in ${reference.referencedTable} (${reference.referencedColumn})`}
                      disabled={running}
                      onClick={() => followReference(reference)}
                    >
                      View row
                      <ExternalLinkIcon aria-hidden="true" data-icon="inline-end" />
                    </Button>
                  ))}
              </div>
              <ValueCopyButton
                value={row[field] === null ? 'null' : String(row[field] ?? '')}
                label={`Copy ${field} value`}
                iconOnly={true}
              />
            </dd>
          </div>
        ))}
      </dl>
      <DialogFooter>
        <ValueCopyButton
          value={JSON.stringify(row, null, 2)}
          label="Copy row JSON"
          iconOnly={false}
        />
      </DialogFooter>
    </DialogContent>
  );
}
