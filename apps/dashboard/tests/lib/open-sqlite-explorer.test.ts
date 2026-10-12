import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { openSqliteExplorer } from '#lib/open-sqlite-explorer.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const replace = mock();
const close = mock();
const assign = mock();
const tab = { opener: {}, location: { replace }, close };
const open = mock(() => tab as unknown as Window | null);

function getHref(url: string): string {
  return `/sqlite?url=${encodeURIComponent(url)}`;
}

beforeEach(() => {
  replace.mockClear();
  close.mockClear();
  assign.mockClear();
  open.mockReset();
  open.mockReturnValue(tab as unknown as Window);
  tab.opener = {};
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { open, location: { assign } },
  });
});

afterEach(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, 'window');
  } else {
    Object.defineProperty(globalThis, 'window', originalWindow);
  }
});

describe('opening the SQLite explorer', () => {
  test('reserves a tab before waiting for a new connection and removes its opener', async () => {
    const connection = Promise.withResolvers<string>();
    const opening = openSqliteExplorer({ getUrl: () => connection.promise, getHref });

    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    expect(replace).not.toHaveBeenCalled();

    connection.resolve('https://nibrun.com/api/sqlite/connection');
    await opening;
    expect(replace).toHaveBeenCalledWith(getHref('https://nibrun.com/api/sqlite/connection'));
    expect(close).not.toHaveBeenCalled();
  });

  test('closes the reserved tab and preserves the connection error on failure', async () => {
    const error = new Error('file is not a database');
    const opening = openSqliteExplorer({ getUrl: () => Promise.reject(error), getHref });

    await expect(opening).rejects.toBe(error);
    expect(close).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  test('opens in the current tab if the browser blocks the new tab', async () => {
    open.mockReturnValue(null);
    await openSqliteExplorer({ getUrl: () => Promise.resolve('saved-connection'), getHref });

    expect(assign).toHaveBeenCalledWith(getHref('saved-connection'));
  });
});
