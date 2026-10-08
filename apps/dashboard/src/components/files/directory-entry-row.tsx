import type { FilesystemEntry } from '@repo/api-client/models';
import { TableCell, TableRow } from '@repo/ui/components/table';
import { EntryName } from '#components/files/entry-name.tsx';
import { FileActions } from '#components/files/file-actions.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import { dayAndMinute } from '#lib/format-timestamp.ts';
import { useFileSqliteConnection } from '#lib/hooks/use-file-sqlite-connection.ts';

export function DirectoryEntryRow({ entry }: { entry: FilesystemEntry }) {
  const sqlite = useFileSqliteConnection(entry);
  return (
    <TableRow>
      <TableCell className="w-full max-w-0 font-mono">
        <EntryName entry={entry} sqlite={sqlite} />
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {entry.kind === 'directory' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span title={`${entry.sizeBytes} bytes`}>{formatBytes(entry.sizeBytes)}</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {dayAndMinute(entry.modifiedAt)}
      </TableCell>
      <TableCell>
        {entry.kind === 'file' && sqlite.connection === undefined && (
          <FileActions entry={entry} sqlite={sqlite} />
        )}
      </TableCell>
    </TableRow>
  );
}
