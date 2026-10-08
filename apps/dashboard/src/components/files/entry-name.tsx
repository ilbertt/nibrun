import type { FilesystemEntry } from '@repo/api-client/models';
import { Link } from '@tanstack/react-router';
import { EntryIcon } from '#components/files/entry-icon.tsx';
import { childPath } from '#lib/child-path.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import type { FileSqliteConnection } from '#lib/hooks/use-file-sqlite-connection.ts';
import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';
import { Route as SqliteRoute } from '#routes/sqlite.tsx';

export function EntryName({
  entry,
  sqlite,
}: {
  entry: FilesystemEntry;
  sqlite: FileSqliteConnection;
}) {
  const appId = useAppId();
  const path = useDirectoryPath();
  const { connection } = sqlite;
  const name = (
    <>
      <EntryIcon entry={entry} sqlite={sqlite} />
      <span className="truncate" title={entry.name}>
        {entry.name}
      </span>
    </>
  );

  if (connection !== undefined) {
    return (
      <Link
        to={SqliteRoute.to}
        search={{ url: connection.url }}
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
