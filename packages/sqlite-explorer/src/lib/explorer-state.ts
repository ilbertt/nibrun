import type { QueryResult } from '@libredb/studio/types';
import type { SqliteRowReference } from '#lib/foreign-keys.ts';
import type { SqliteConnection } from '#lib/query.ts';

export type ExplorerLocation = {
  query: string;
  view: 'table' | 'sql';
  resultQuery: string;
  resultTable: string | undefined;
  result: QueryResult | undefined;
  references: SqliteRowReference[][];
};

export type ExplorerState = {
  connection: SqliteConnection | undefined;
  connecting: boolean;
  running: boolean;
  error: string | undefined;
  tables: QueryResult['rows'];
  location: ExplorerLocation;
  navigationHistory: ExplorerLocation[];
  queryHistory: ExplorerLocation[];
};

export type ExplorerAction =
  | { type: 'connecting' }
  | {
      type: 'connected';
      connection: SqliteConnection;
      tables: QueryResult['rows'];
      location: ExplorerLocation;
    }
  | { type: 'running' }
  | { type: 'failed'; error: string }
  | { type: 'queried'; location: ExplorerLocation; rememberCurrent: boolean }
  | { type: 'query'; query: string }
  | { type: 'sql-editor' }
  | { type: 'back' }
  | { type: 'previous-query' }
  | { type: 'disconnect' };

export function initialExplorerState(): ExplorerState {
  return {
    connection: undefined,
    connecting: false,
    running: false,
    error: undefined,
    tables: [],
    location: {
      query: '',
      view: 'table',
      resultQuery: '',
      resultTable: undefined,
      result: undefined,
      references: [],
    },
    navigationHistory: [],
    queryHistory: [],
  };
}

export function reduceExplorerState({
  state,
  action,
}: {
  state: ExplorerState;
  action: ExplorerAction;
}): ExplorerState {
  switch (action.type) {
    case 'connecting':
      return { ...state, connecting: true, error: undefined };
    case 'connected':
      return {
        ...initialExplorerState(),
        connection: action.connection,
        tables: action.tables,
        location: action.location,
      };
    case 'running':
      return { ...state, running: true, error: undefined };
    case 'failed':
      return { ...state, connecting: false, running: false, error: action.error };
    case 'queried':
      return {
        ...state,
        running: false,
        error: undefined,
        location: action.location,
        navigationHistory:
          action.rememberCurrent && state.location.result
            ? [...state.navigationHistory, state.location]
            : state.navigationHistory,
        queryHistory:
          action.location.view === 'sql'
            ? [...state.queryHistory, action.location]
            : state.queryHistory,
      };
    case 'query':
      return { ...state, location: { ...state.location, query: action.query } };
    case 'sql-editor':
      return {
        ...state,
        error: undefined,
        location: state.queryHistory.at(-1) ?? {
          ...state.location,
          view: 'sql',
          result: undefined,
          references: [],
        },
      };
    case 'back': {
      const location = state.navigationHistory.at(-1);
      return location
        ? {
            ...state,
            location,
            error: undefined,
            navigationHistory: state.navigationHistory.slice(0, -1),
          }
        : state;
    }
    case 'previous-query': {
      const location = state.queryHistory.at(-2);
      return location
        ? { ...state, location, error: undefined, queryHistory: state.queryHistory.slice(0, -1) }
        : state;
    }
    case 'disconnect':
      return initialExplorerState();
  }
}
