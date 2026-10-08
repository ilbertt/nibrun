import { DialogTrigger } from '@repo/ui/components/dialog';
import type { SqliteRowReference } from '#lib/foreign-keys.ts';

export function ResultCell({
  value,
  field,
  rowNumber,
  references,
  running,
  openDetails,
  followReference,
}: {
  value: unknown;
  field: string;
  rowNumber: number;
  references: SqliteRowReference[];
  running: boolean;
  openDetails: () => void;
  followReference: (reference: SqliteRowReference) => void;
}) {
  const targets = references.filter((reference) => reference.columnName === field);
  const labelValue = value === null ? 'NULL' : String(value ?? '');
  const content =
    value === null ? (
      <span className="text-muted-foreground italic">NULL</span>
    ) : (
      String(value ?? '')
    );
  const reference = targets.length === 1 ? targets[0] : undefined;

  if (reference) {
    return (
      <button
        type="button"
        className="sqlite-results-cell text-primary underline underline-offset-4 disabled:opacity-50"
        aria-label={`Open ${reference.referencedTable} row referenced by ${field}: ${labelValue}`}
        title={`Open ${reference.referencedTable}.${reference.referencedColumn}`}
        disabled={running}
        onClick={() => followReference(reference)}
      >
        {content}
      </button>
    );
  }

  return (
    <DialogTrigger
      render={
        <button
          type="button"
          className={
            targets.length > 1
              ? 'sqlite-results-cell text-primary underline underline-offset-4'
              : 'sqlite-results-cell'
          }
        />
      }
      aria-label={`View row ${rowNumber} details, ${field}: ${labelValue}`}
      title={targets.length > 1 ? 'Choose a referenced row' : 'View row details'}
      onClick={openDetails}
    >
      {content}
    </DialogTrigger>
  );
}
