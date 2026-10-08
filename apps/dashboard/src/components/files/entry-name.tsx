import type { FilesystemEntry, FilesystemEntryKind } from '@repo/api-client/models';
import { Link } from '@tanstack/react-router';
import {
  DatabaseIcon,
  FileIcon,
  FileQuestionMarkIcon,
  FolderIcon,
  type LucideIcon,
} from 'lucide-react';
import { childPath } from '#lib/child-path.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import { useFileSqliteConnection } from '#lib/hooks/use-file-sqlite-connection.ts';
import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';
import { Route as SqliteRoute } from '#routes/sqlite.tsx';

const KIND_ICONS: Record<FilesystemEntryKind, LucideIcon> = {
  directory: FolderIcon,
  file: FileIcon,
  other: FileQuestionMarkIcon,
};

export function EntryName({ entry }: { entry: FilesystemEntry }) {
  const appId = useAppId();
  const path = useDirectoryPath();
  const connection = useFileSqliteConnection(entry);
  const Icon = connection === undefined ? KIND_ICONS[entry.kind] : DatabaseIcon;
  const name = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate" title={entry.name}>
        {entry.name}
      </span>
    </>
  );

  if (connection !== undefined) {
    return (
      <Link
        to={SqliteRoute.to}
        search={{ url: connection.url, appId }}
        target="_blank"
        rel="noopener"
        className="flex items-center gap-2 hover:underline"
        aria-label={`Open ${entry.name} in SQLite explorer (new tab)`}
      >
        {name}
      </Link>
    );
  }

  if (entry.kind !== 'directory') {
    return <span className="flex items-center gap-2">{name}</span>;
  }

  return (
    <Link
      to={FilesRoute.to}
      params={{ appId }}
      search={{ path: childPath({ path, name: entry.name }) }}
      className="flex items-center gap-2 hover:underline"
    >
      {name}
    </Link>
  );
}
