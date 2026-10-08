import { guestPath } from '@repo/app-operations';

export function childPath({ path, name }: { path: string; name: string }): string {
  const directory = guestPath(path);
  return directory === '/' ? `/${name}` : `${directory}/${name}`;
}
