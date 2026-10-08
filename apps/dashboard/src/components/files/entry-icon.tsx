import type { FilesystemEntry, FilesystemEntryKind } from '@repo/api-client/models';
import {
  DatabaseIcon,
  FileIcon,
  FileQuestionMarkIcon,
  FolderIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from 'lucide-react';
import { SqliteConnectionError } from '#components/files/sqlite-connection-error.tsx';
import type { FileSqliteConnection } from '#lib/hooks/use-file-sqlite-connection.ts';

const KIND_ICONS: Record<FilesystemEntryKind, LucideIcon> = {
  directory: FolderIcon,
  file: FileIcon,
  other: FileQuestionMarkIcon,
};

export function EntryIcon({
  entry,
  sqlite,
}: {
  entry: FilesystemEntry;
  sqlite: FileSqliteConnection;
}) {
  if (sqlite.isPending) {
    return (
      <span role="status" className="size-4 shrink-0 text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        <span className="sr-only">Checking {entry.name} as a SQLite database</span>
      </span>
    );
  }
  if (sqlite.connection === undefined && sqlite.error !== null) {
    return <SqliteConnectionError name={entry.name} error={sqlite.error} />;
  }
  const Icon = sqlite.connection === undefined ? KIND_ICONS[entry.kind] : DatabaseIcon;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}
