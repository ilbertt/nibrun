import { useEffect, useRef, useState } from 'react';
import type { SqliteConnection } from '#lib/connection.ts';
import { createSqliteWorkspace, type SqliteWorkspace } from '#lib/workspace.ts';

export function useSqliteExplorer() {
  const [workspace, setWorkspace] = useState<SqliteWorkspace>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const pending = useRef(false);

  useEffect(() => () => workspace?.close(), [workspace]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  async function openConnection(connection: SqliteConnection): Promise<void> {
    const requestGeneration = generation.current;
    let next: SqliteWorkspace | undefined;
    pending.current = true;
    setConnecting(true);
    setError(undefined);
    try {
      next = createSqliteWorkspace(connection);
      await next.props.onObjectsFetch.countObjects(next.url, []);
      if (requestGeneration === generation.current) {
        setWorkspace(next);
      } else {
        next.close();
      }
    } catch (failure) {
      next?.close();
      if (requestGeneration === generation.current) {
        setError(failure instanceof Error ? failure.message : 'Could not open this database.');
      }
    } finally {
      if (requestGeneration === generation.current) {
        pending.current = false;
        setConnecting(false);
      }
    }
  }

  function connect(connection: SqliteConnection): void {
    if (!pending.current) {
      void openConnection(connection);
    }
  }

  function disconnect(): void {
    generation.current += 1;
    workspace?.close();
    setWorkspace(undefined);
    pending.current = false;
    setConnecting(false);
    setError(undefined);
  }

  return { workspace, connecting, error, connect, disconnect };
}
