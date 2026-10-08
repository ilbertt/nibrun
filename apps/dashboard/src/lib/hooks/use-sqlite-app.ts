import { useApp } from '#lib/hooks/use-app.ts';
import { useSqliteConnection } from '#lib/hooks/use-sqlite-connection.ts';
import type { AppSummary } from '#queries/apps.ts';

export function useSqliteApp(): AppSummary | undefined {
  const connection = useSqliteConnection();
  return useApp(connection.data?.appId).data;
}
