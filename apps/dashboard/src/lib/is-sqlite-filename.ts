const SQLITE_EXTENSIONS = new Set([
  'db',
  'database',
  'sqlite',
  'sqlite3',
  'db3',
  'sdb',
  's3db',
  'sl3',
]);

export function isSqliteFilename(name: string): boolean {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return name.includes('.') && SQLITE_EXTENSIONS.has(extension);
}
