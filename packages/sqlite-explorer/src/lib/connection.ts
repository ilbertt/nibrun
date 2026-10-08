export type SqliteConnection = { url: string; authToken: string };

export function validateSqliteConnection(connection: SqliteConnection): SqliteConnection {
  const url = new URL(connection.url.trim().replace(/^libsql:/, 'https:'));
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP, HTTPS, or libsql:// database URL without credentials or query parameters.',
    );
  }
  return { url: url.href, authToken: connection.authToken.trim() };
}
