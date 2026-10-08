import { describe, expect, test } from 'bun:test';
import {
  type ExplorerAction,
  type ExplorerLocation,
  initialExplorerState,
  reduceExplorerState,
} from '#lib/explorer-state.ts';
import { TABLE_PAGE_SIZE } from '#lib/query.ts';

function location(view: ExplorerLocation['view']): ExplorerLocation {
  return {
    query: 'SELECT id FROM users',
    view,
    resultQuery: 'SELECT id FROM users',
    resultTable: 'users',
    references: [],
    result: { fields: ['id'], rows: [{ id: 1 }], rowCount: 1, executionTime: 0 },
  };
}

function navigate(actions: ExplorerAction[]) {
  let state = initialExplorerState();
  for (const action of actions) {
    state = reduceExplorerState({ state, action });
  }
  return state;
}

describe('SQLite explorer navigation', () => {
  test('Back restores the source table and page after following a foreign key', () => {
    const source = location('table');
    source.result = {
      ...source.result!,
      pagination: {
        limit: TABLE_PAGE_SIZE,
        offset: TABLE_PAGE_SIZE,
        hasMore: false,
        totalReturned: TABLE_PAGE_SIZE + 1,
        wasLimited: true,
      },
    };
    const destination = {
      ...location('table'),
      query: 'SELECT * FROM orders',
      resultTable: 'orders',
    };
    const state = navigate([
      { type: 'queried', location: source, rememberCurrent: false },
      { type: 'queried', location: destination, rememberCurrent: true },
      { type: 'back' },
    ]);
    expect(state.location).toEqual(source);
    expect(state.navigationHistory).toEqual([]);
  });

  test('failed queries and table pagination do not consume SQL query history', () => {
    const first = location('sql');
    const second = { ...location('sql'), query: 'SELECT 2', resultQuery: 'SELECT 2' };
    const state = navigate([
      { type: 'queried', location: first, rememberCurrent: false },
      { type: 'queried', location: second, rememberCurrent: false },
      { type: 'queried', location: location('table'), rememberCurrent: true },
      { type: 'queried', location: location('table'), rememberCurrent: false },
      { type: 'sql-editor' },
      { type: 'failed', error: 'SQLITE_ERROR: no such table' },
      { type: 'previous-query' },
    ]);
    expect(state.location).toEqual(first);
    expect(state.error).toBeUndefined();
    expect(state.queryHistory).toEqual([first]);
  });

  test('opening the SQL editor starts without table results, then restores its last query', () => {
    const first = navigate([
      { type: 'queried', location: location('table'), rememberCurrent: false },
      { type: 'sql-editor' },
    ]);
    expect(first.location.view).toBe('sql');
    expect(first.location.result).toBeUndefined();
    const query = location('sql');
    const state = navigate([
      { type: 'queried', location: query, rememberCurrent: false },
      { type: 'queried', location: location('table'), rememberCurrent: true },
      { type: 'sql-editor' },
    ]);
    expect(state.location).toEqual(query);
  });

  test('disconnect clears credentials, rows, errors and both navigation histories', () => {
    const state = navigate([
      {
        type: 'connected',
        connection: { url: 'https://example.com/', authToken: 'test-token' },
        tables: [{ name: 'users' }],
        location: location('table'),
      },
      { type: 'queried', location: location('sql'), rememberCurrent: true },
      { type: 'failed', error: 'SQLITE_READONLY' },
      { type: 'disconnect' },
    ]);
    expect(state).toEqual(initialExplorerState());
  });
});
