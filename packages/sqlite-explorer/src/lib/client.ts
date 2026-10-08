import { createClient, type InStatement } from '@libsql/client/web';
import type { SqliteConnection } from '#lib/connection.ts';

const QUERY_TIMEOUT_MS = 15_000;
function fetchDatabase(request: Request): Promise<Response> {
  return fetch(request, {
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
}

export function createSqliteDatabase(connection: SqliteConnection) {
  // Catalog reads fan out; one request at a time leaves guest sessions available to other clients.
  const client = createClient({
    url: connection.url,
    authToken: connection.authToken || undefined,
    intMode: 'bigint',
    concurrency: 1,
    fetch: fetchDatabase,
  });

  async function execute(statement: InStatement) {
    try {
      return await client.execute(statement);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Could not query this database.';
      throw new Error(
        connection.authToken ? message.replaceAll(connection.authToken, '[redacted]') : message,
      );
    }
  }

  function close(): void {
    client.close();
  }

  return { execute, close };
}

export type SqliteDatabase = ReturnType<typeof createSqliteDatabase>;
