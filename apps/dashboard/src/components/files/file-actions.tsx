import type { FilesystemEntry } from '@repo/api-client/models';
import { Button } from '@repo/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { Link } from '@tanstack/react-router';
import { DatabaseIcon, EllipsisIcon } from 'lucide-react';
import type { FileSqliteConnection } from '#lib/hooks/use-file-sqlite-connection.ts';
import { Route as SqliteRoute } from '#routes/sqlite.tsx';

export function FileActions({
  entry,
  sqlite,
}: {
  entry: FilesystemEntry;
  sqlite: FileSqliteConnection;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${entry.name}`} />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem
          render={
            <Link
              to={SqliteRoute.to}
              search={sqlite.search}
              target="_blank"
              rel="noopener"
              preload={false}
            />
          }
        >
          <DatabaseIcon />
          {sqlite.isDatabase ? 'Open SQLite database' : 'Query as SQLite'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
