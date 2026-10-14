import type { FilesystemEntry } from '@repo/api-client/models';
import { Link } from '@tanstack/react-router';
import { EntryIcon } from '#components/files/entry-icon.tsx';
import { childPath } from '#lib/child-path.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import type { FileSqliteConnection } from '#lib/hooks/use-file-sqlite-connection.ts';
import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';

export function EntryName({
  entry,
  sqlite,
}: {
  entry: FilesystemEntry;
  sqlite: FileSqliteConnection;
}) {
  const appId = useAppId();
  const path = useDirectoryPath();
  const name = (
    <>
      <EntryIcon entry={entry} sqlite={sqlite} />
      <span className="truncate" title={entry.name}>
        {entry.name}
      </span>
    </>
  );

  if (sqlite.isDatabase) {
    return (
      <span className="flex items-center gap-2">
        <EntryIcon entry={entry} sqlite={sqlite} />
        <button
          type="button"
          onClick={sqlite.open}
          disabled={sqlite.isOpening}
          aria-busy={sqlite.isOpening}
          className="cursor-pointer truncate text-left hover:underline disabled:cursor-wait"
          title={entry.name}
          aria-label={`Open ${entry.name} in SQLite explorer`}
        >
          {entry.name}
        </button>
      </span>
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
