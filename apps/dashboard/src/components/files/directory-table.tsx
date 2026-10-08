import type { FilesystemEntry } from '@repo/api-client/models';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@repo/ui/components/table';
import { DirectoryEntryRow } from '#components/files/directory-entry-row.tsx';
import { childPath } from '#lib/child-path.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';

export function DirectoryTable({ entries }: { entries: readonly FilesystemEntry[] }) {
  const path = useDirectoryPath();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Modified</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {inBrowsingOrder(entries).map((entry) => (
          <DirectoryEntryRow key={childPath({ path, name: entry.name })} entry={entry} />
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
