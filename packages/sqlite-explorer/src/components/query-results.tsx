import type { QueryResult } from '@libredb/studio/types';
import { Dialog } from '@repo/ui/components/dialog';
import { useState } from 'react';
import { ResultCell } from '#components/result-cell.tsx';
import { ResultPagination } from '#components/result-pagination.tsx';
import { ResultStats } from '#components/result-stats.tsx';
import { RowDetails } from '#components/row-details.tsx';
import type { SqliteRowReference } from '#lib/foreign-keys.ts';

export function QueryResults({
  result,
  running,
  loadPage,
  references,
  followReference,
}: {
  result: QueryResult;
  running: boolean;
  loadPage: (offset: number) => void;
  references: SqliteRowReference[][];
  followReference: (reference: SqliteRowReference) => void;
}) {
  const [selectedRow, setSelectedRow] = useState<{
    row: QueryResult['rows'][number];
    number: number;
    references: SqliteRowReference[];
  }>();
  const pagination = result.pagination;
  const offset = pagination?.offset ?? 0;

  return (
    <Dialog
      open={selectedRow !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          setSelectedRow(undefined);
        }
      }}
    >
      <div className="flex h-full min-h-0 flex-col">
        <ResultStats result={result} offset={offset} />
        <div key={offset} aria-busy={running} className="min-h-0 flex-1 overflow-auto">
          <table aria-label="Query results" className="sqlite-results-table">
            <thead>
              <tr>
                {result.fields.map((field) => (
                  <th key={field} scope="col" title={result.columnTypes?.[field]}>
                    {field}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(result.rows.entries(), ([index, row]) => (
                <tr key={offset + index}>
                  {result.fields.map((field) => (
                    <td key={field}>
                      <ResultCell
                        value={row[field]}
                        field={field}
                        rowNumber={offset + index + 1}
                        references={references[index] ?? []}
                        running={running}
                        openDetails={() =>
                          setSelectedRow({
                            row,
                            number: offset + index + 1,
                            references: references[index] ?? [],
                          })
                        }
                        followReference={followReference}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground text-sm">Query returned no rows.</p>
          ) : null}
        </div>
        {pagination ? (
          <ResultPagination pagination={pagination} running={running} loadPage={loadPage} />
        ) : null}
      </div>
      {selectedRow ? (
        <RowDetails
          key={selectedRow.number}
          row={selectedRow.row}
          number={selectedRow.number}
          fields={result.fields}
          columnTypes={result.columnTypes}
          references={selectedRow.references}
          running={running}
          followReference={(reference) => {
            setSelectedRow(undefined);
            followReference(reference);
          }}
        />
      ) : null}
    </Dialog>
  );
}
