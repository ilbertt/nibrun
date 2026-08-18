import type { FilesystemEntry } from '@repo/protocol';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table';
import { EntryName } from '#components/files/entry-name.tsx';
import { formatBytes } from '#lib/format-bytes.ts';
import { dayAndMinute } from '#lib/format-timestamp.ts';

export function DirectoryTable({ entries }: { entries: readonly FilesystemEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Modified</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {inBrowsingOrder(entries).map((entry) => (
          <TableRow key={entry.name}>
            <TableCell className="w-full max-w-0 font-mono">
              <EntryName entry={entry} />
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function inBrowsingOrder(entries: readonly FilesystemEntry[]): FilesystemEntry[] {
  const found = new Map(entries.map((entry) => [entry.name, entry]));
  return [...found.values()].sort(byDirectoryThenName);
}

// biome-ignore lint/complexity/useMaxParams: a comparator compares two entries
function byDirectoryThenName(left: FilesystemEntry, right: FilesystemEntry): number {
  const leftIsDirectory = left.kind === 'directory';
  const rightIsDirectory = right.kind === 'directory';
  if (leftIsDirectory !== rightIsDirectory) {
    return leftIsDirectory ? -1 : 1;
  }
  return left.name < right.name ? -1 : 1;
}
