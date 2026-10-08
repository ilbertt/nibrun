import type { FilesystemEntry } from '@repo/api-client/models';
import { Button } from '@repo/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { DatabaseIcon, EllipsisIcon } from 'lucide-react';
import type { FileSqliteConnection } from '#lib/hooks/use-file-sqlite-connection.ts';

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
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${entry.name}`}
            disabled={sqlite.isPending || !sqlite.canCreate}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onClick={sqlite.create}>
          <DatabaseIcon />
          Mark as SQLite database
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
