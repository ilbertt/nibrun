import type { FilesystemEntry, FilesystemEntryKind } from '@repo/protocol';
import { Link } from '@tanstack/react-router';
import { FileIcon, FileQuestionMarkIcon, FolderIcon, type LucideIcon } from 'lucide-react';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDirectoryPath } from '#lib/hooks/use-directory-path.ts';
import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';

const KIND_ICONS: Record<FilesystemEntryKind, LucideIcon> = {
  directory: FolderIcon,
  file: FileIcon,
  other: FileQuestionMarkIcon,
};

export function EntryName({ entry }: { entry: FilesystemEntry }) {
  const appId = useAppId();
  const path = useDirectoryPath();
  const Icon = KIND_ICONS[entry.kind];
  const name = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate" title={entry.name}>
        {entry.name}
      </span>
    </>
  );

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

function childPath({ path, name }: { path: string; name: string }): string {
  return path.endsWith('/') ? `${path}${name}` : `${path}/${name}`;
}
