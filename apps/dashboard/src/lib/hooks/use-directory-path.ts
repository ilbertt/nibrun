import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';

export function useDirectoryPath(): string {
  return FilesRoute.useSearch().path;
}
