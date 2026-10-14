import type { FilesystemEntry, FilesystemEntryKind } from '@repo/api-client/models';
import {
  DatabaseIcon,
  FileIcon,
  FileQuestionMarkIcon,
  FolderIcon,
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
  if (sqlite.error !== null) {
    return <SqliteConnectionError name={entry.name} error={sqlite.error} />;
  }
  const Icon = sqlite.isDatabase ? DatabaseIcon : KIND_ICONS[entry.kind];
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}
