import { useSqliteConnection } from '#lib/hooks/use-sqlite-connection.ts';

export function useSqliteFilePath(): string | undefined {
  const path = useSqliteConnection().data?.sqlite_file_path;
  return path?.startsWith('/') ? path.slice(1) : path;
}
