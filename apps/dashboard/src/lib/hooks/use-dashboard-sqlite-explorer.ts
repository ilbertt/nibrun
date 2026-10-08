import { createSqliteWorkspace, type SqliteWorkspace } from '@repo/sqlite-explorer';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { dashboardSqliteConnection } from '#lib/dashboard-sqlite-connection.ts';
import { sqliteConnectionsQueryOptions } from '#queries/sqlite-connections.ts';
import { Route } from '#routes/sqlite/$appId/index.tsx';

type OpenedWorkspace = {
  url: string;
  workspace: SqliteWorkspace | undefined;
  error: string | undefined;
};
export type DashboardSqliteExplorer = {
  workspace: SqliteWorkspace | undefined;
  error: string | undefined;
  path: string | undefined;
  fileName: string | undefined;
};

export function useDashboardSqliteExplorer(): DashboardSqliteExplorer {
  const { appId } = Route.useParams();
  const { url: requestedUrl } = Route.useSearch();
  const connections = useQuery(sqliteConnectionsQueryOptions(appId));
  const connection = dashboardSqliteConnection({
    connections: connections.data ?? [],
    url: requestedUrl,
    origin: window.location.origin,
  });
  const url = connection?.url;
  const [opened, setOpened] = useState<OpenedWorkspace>();

  useEffect(() => {
    if (url === undefined) {
      return;
    }
    const workspace = createSqliteWorkspace({ url, authToken: '' });
    let active = true;
    async function open(): Promise<void> {
      try {
        await workspace.props.onObjectsFetch.countObjects(workspace.url, []);
        if (active) {
          setOpened({ url: workspace.url, workspace, error: undefined });
        }
      } catch (failure) {
        workspace.close();
        if (active) {
          setOpened({
            url: workspace.url,
            workspace: undefined,
            error: failure instanceof Error ? failure.message : 'Could not open this database.',
          });
        }
      }
    }
    void open();
    return () => {
      active = false;
      workspace.close();
    };
  }, [url]);

  const current = opened?.url === url ? opened : undefined;
  const error =
    connections.error?.message ??
    (connections.data !== undefined && connection === undefined
      ? 'This SQLite connection is not available for this app.'
      : current?.error);
  return {
    workspace: current?.workspace,
    error,
    path: connection?.sqlite_file_path,
    fileName: connection?.sqlite_file_path.split('/').at(-1),
  };
}
