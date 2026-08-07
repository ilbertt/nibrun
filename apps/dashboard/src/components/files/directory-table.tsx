import type { FilesystemEntry } from '@repo/protocol';
import { Link } from '@tanstack/react-router';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table.tsx';
import { dayAndMinute } from '#lib/format-timestamp.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';

export function DirectoryTable({ entries }: { entries: readonly FilesystemEntry[] }) {
  const appId = useAppId();
  const path = useDirectoryPath();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kind</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Modified</TableHead>
          <TableHead>Name</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {byName(entries).map((entry) => (
          <TableRow key={entry.name}>
            <TableCell className="text-muted-foreground">{entry.kind}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{entry.sizeBytes}</TableCell>
            <TableCell className="text-muted-foreground tabular-nums">
              {dayAndMinute(entry.modifiedAt)}
            </TableCell>
            <TableCell className="font-mono">
              {entry.kind === 'directory' ? (
                <Link
                  to={FilesRoute.to}
                  params={{ appId }}
                  search={{ path: childPath({ path, name: entry.name }) }}
                  className="hover:underline"
                >
                  {entry.name}
                </Link>
              ) : (
                entry.name
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function childPath({ path, name }: { path: string; name: string }): string {
  return path.endsWith('/') ? `${path}${name}` : `${path}/${name}`;
}

function byName(entries: readonly FilesystemEntry[]): FilesystemEntry[] {
  const found = new Map(entries.map((entry) => [entry.name, entry]));
  return [...found.keys()].toSorted().map((name) => found.get(name)!);
}
