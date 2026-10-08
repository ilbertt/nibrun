import { useRef, useState } from 'react';
import { executeSqliteQuery } from '#lib/client.ts';
import { openSqliteDatabase } from '#lib/database.ts';
import {
  type ExplorerAction,
  type ExplorerLocation,
  initialExplorerState,
  reduceExplorerState,
} from '#lib/explorer-state.ts';
import type { SqliteRowReference } from '#lib/foreign-keys.ts';
import { type SqliteConnection, tableQuery, validateSqliteQuery } from '#lib/query.ts';

type QueryNavigation = {
  sql: string;
  offset: number | undefined;
  table: string | undefined;
  rememberCurrent: boolean;
  view: ExplorerLocation['view'];
};

export function useSqliteExplorer() {
  const [state, setState] = useState(initialExplorerState);
  const generation = useRef(0);
  const pending = useRef(false);

  function dispatch(action: ExplorerAction): void {
    setState((state) => reduceExplorerState({ state, action }));
  }

  function connect(connection: SqliteConnection): void {
    if (pending.current) {
      return;
    }
    void openConnection(connection);
  }

  async function openConnection(connection: SqliteConnection): Promise<void> {
    const requestGeneration = generation.current;
    pending.current = true;
    dispatch({ type: 'connecting' });
    try {
      const database = await openSqliteDatabase(connection);
      if (requestGeneration === generation.current) {
        dispatch({ type: 'connected', connection, ...database });
      }
    } catch (failure) {
      failRequest({ requestGeneration, failure });
    } finally {
      finishRequest(requestGeneration);
    }
  }

  async function runPage(input: QueryNavigation): Promise<void> {
    if (!state.connection || pending.current) {
      return;
    }
    const requestGeneration = generation.current;
    pending.current = true;
    dispatch({ type: 'running' });
    const query = input.view === 'sql' ? state.location.query : input.sql;
    try {
      const response = await executeSqliteQuery(
        validateSqliteQuery({
          ...state.connection,
          sql: input.sql,
          offset: input.offset,
          table: input.table,
        }),
      );
      if (requestGeneration !== generation.current) {
        return;
      }
      if (response.error !== undefined) {
        dispatch({ type: 'failed', error: response.error });
        return;
      }
      dispatch({
        type: 'queried',
        rememberCurrent: input.rememberCurrent,
        location: {
          query,
          view: input.view,
          resultQuery: input.sql,
          resultTable: input.table,
          result: response.result,
          references: response.references,
        },
      });
    } catch (failure) {
      failRequest({ requestGeneration, failure });
    } finally {
      finishRequest(requestGeneration);
    }
  }

  function failRequest({
    requestGeneration,
    failure,
  }: {
    requestGeneration: number;
    failure: unknown;
  }): void {
    if (requestGeneration === generation.current) {
      dispatch({ type: 'failed', error: errorMessage(failure) });
    }
  }

  function finishRequest(requestGeneration: number): void {
    if (requestGeneration === generation.current) {
      pending.current = false;
    }
  }

  async function run(sql: string): Promise<void> {
    await runPage({
      sql,
      offset: undefined,
      table:
        sql.trim() === state.location.resultQuery.trim() ? state.location.resultTable : undefined,
      rememberCurrent: false,
      view: 'sql',
    });
  }

  function loadPage(offset: number): void {
    if (state.location.view === 'table') {
      void runPage({
        sql: state.location.resultQuery,
        offset,
        table: state.location.resultTable,
        rememberCurrent: false,
        view: 'table',
      });
    }
  }

  function openTable(name: string): void {
    void runPage({
      sql: tableQuery(name),
      offset: 0,
      table: name,
      rememberCurrent: true,
      view: 'table',
    });
  }

  function followReference(reference: SqliteRowReference): void {
    void runPage({
      sql: reference.sql,
      offset: 0,
      table: reference.referencedTable,
      rememberCurrent: true,
      view: 'table',
    });
  }

  function openSqlEditor(): void {
    if (!pending.current && state.location.view !== 'sql') {
      dispatch({ type: 'sql-editor' });
    }
  }

  function goBack(): void {
    if (!pending.current) {
      dispatch({ type: 'back' });
    }
  }

  function loadPreviousQuery(): void {
    if (!pending.current) {
      dispatch({ type: 'previous-query' });
    }
  }

  function setQuery(query: string): void {
    dispatch({ type: 'query', query });
  }

  function disconnect(): void {
    generation.current += 1;
    pending.current = false;
    dispatch({ type: 'disconnect' });
  }

  return {
    ...state.location,
    connection: state.connection,
    connecting: state.connecting,
    running: state.running,
    error: state.error,
    tables: state.tables,
    canGoBack: state.navigationHistory.length > 0,
    canLoadPreviousQuery: state.queryHistory.length > 1,
    connect,
    disconnect,
    run,
    loadPage,
    openTable,
    openSqlEditor,
    followReference,
    goBack,
    loadPreviousQuery,
    setQuery,
  };
}

function errorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'Could not query this database.';
}
