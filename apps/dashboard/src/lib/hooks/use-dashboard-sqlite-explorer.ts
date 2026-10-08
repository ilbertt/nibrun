import { createSqliteWorkspace, type SqliteWorkspace } from '@repo/sqlite-explorer';
import { useEffect, useState } from 'react';
import { Route } from '#routes/sqlite.tsx';

type OpenedWorkspace = {
  url: string;
  workspace: SqliteWorkspace | undefined;
  error: string | undefined;
};
export type DashboardSqliteExplorer = {
  workspace: SqliteWorkspace | undefined;
  error: string | undefined;
  fileName: string | undefined;
};

export function useDashboardSqliteExplorer(): DashboardSqliteExplorer {
  const { url, fileName } = Route.useSearch();
  const [opened, setOpened] = useState<OpenedWorkspace>();

  useEffect(() => {
    if (url === '') {
      return;
    }
    let workspace: SqliteWorkspace | undefined;
    let active = true;
    async function open(): Promise<void> {
      try {
        workspace = createSqliteWorkspace({ url, authToken: '' });
        await workspace.props.onObjectsFetch.countObjects(workspace.url, []);
        if (active) {
          setOpened({ url, workspace, error: undefined });
        }
      } catch (failure) {
        workspace?.close();
        if (active) {
          setOpened({
            url,
            workspace: undefined,
            error: failure instanceof Error ? failure.message : 'Could not open this database.',
          });
        }
      }
    }
    void open();
    return () => {
      active = false;
      workspace?.close();
    };
  }, [url]);

  const current = opened?.url === url ? opened : undefined;
  const error = url === '' ? 'A SQLite connection URL is required.' : current?.error;
  return {
    workspace: current?.workspace,
    error,
    fileName: fileName || undefined,
  };
}
