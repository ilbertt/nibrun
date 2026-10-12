import { describe, expect, test } from 'bun:test';
import { isSqliteFilename } from '#lib/is-sqlite-filename.ts';

describe('SQLite filename recognition', () => {
  test('recognizes database extensions regardless of case', () => {
    for (const extension of ['db', 'database', 'sqlite', 'sqlite3', 'db3', 'sdb', 's3db', 'sl3']) {
      expect(isSqliteFilename(`app.${extension}`)).toBe(true);
      expect(isSqliteFilename(`app.${extension.toUpperCase()}`)).toBe(true);
    }
  });

  test('excludes sidecars, backups, and names without an extension', () => {
    for (const name of [
      'app.db-wal',
      'app.sqlite-shm',
      'app.db-journal',
      'app.db.bak',
      'sqlite',
      'db',
      'app.txt',
    ]) {
      expect(isSqliteFilename(name)).toBe(false);
    }
  });
});
