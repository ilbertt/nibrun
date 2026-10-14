import type { FilesystemEntry } from '@repo/api-client/models';
import { Button } from '@repo/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { DatabaseIcon, EllipsisIcon, LoaderCircleIcon } from 'lucide-react';
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
        disabled={sqlite.isOpening}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${entry.name}`}
            aria-busy={sqlite.isOpening}
          />
        }
      >
        {sqlite.isOpening ? <LoaderCircleIcon className="animate-spin" /> : <EllipsisIcon />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem
          render={
            sqlite.href === undefined
              ? undefined
              : (props) => (
                  <a
                    {...props}
                    href={sqlite.href}
                    target="_blank"
                    rel="noopener"
                    aria-label={`Open ${entry.name} in SQLite explorer (new tab)`}
                  />
                )
          }
          onClick={sqlite.href === undefined ? sqlite.open : undefined}
          disabled={sqlite.isOpening}
        >
          <DatabaseIcon />
          {sqlite.isDatabase ? 'Open SQLite database' : 'Query as SQLite'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
