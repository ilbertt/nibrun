import type { StudioWorkspaceProps, WorkspaceObjectReader } from '@libredb/studio/workspace';
import {
  SQLITE_OBJECT_KINDS,
  SQLITE_WORKSPACE_CAPABILITIES,
  SQLITE_WORKSPACE_FEATURES,
} from '#lib/capabilities.ts';
import { describeSqliteObject, listSqliteObjects, readSqliteSchema } from '#lib/catalog.ts';
import { createSqliteDatabase } from '#lib/client.ts';
import { type SqliteConnection, validateSqliteConnection } from '#lib/connection.ts';
import { executeWorkspaceQuery } from '#lib/workspace-query.ts';

export function createSqliteWorkspace(input: SqliteConnection) {
  const connection = validateSqliteConnection(input);
  const database = createSqliteDatabase(connection);
  const connectionId = connection.url;

  function assertConnection(id: string): void {
    if (id !== connectionId) {
      throw new Error('Unknown SQLite connection.');
    }
  }

  async function onQueryExecute(...args: Parameters<StudioWorkspaceProps['onQueryExecute']>) {
    const [id, sql, options] = args;
    assertConnection(id);
    return await executeWorkspaceQuery({ database, sql, options });
  }

  async function onSchemaFetch(id: string) {
    assertConnection(id);
    return await readSqliteSchema(database);
  }

  function listContainers(...args: Parameters<WorkspaceObjectReader['listContainers']>) {
    assertConnection(args[0]);
    return Promise.resolve([]);
  }

  async function countObjects(...args: Parameters<WorkspaceObjectReader['countObjects']>) {
    assertConnection(args[0]);
    const objects = await listSqliteObjects(database);
    return Object.fromEntries(
      SQLITE_OBJECT_KINDS.map((kind) => [
        kind.id,
        { count: objects.filter((object) => object.kind === kind.id).length },
      ]),
    );
  }

  async function listObjects(...args: Parameters<WorkspaceObjectReader['listObjects']>) {
    const [id, , kind] = args;
    assertConnection(id);
    return (await listSqliteObjects(database)).filter((object) => object.kind === kind);
  }

  async function describeObject(
    ...args: Parameters<NonNullable<WorkspaceObjectReader['describeObject']>>
  ) {
    const [id, path] = args;
    assertConnection(id);
    return await describeSqliteObject({ database, path });
  }

  const props: StudioWorkspaceProps = {
    connections: [
      {
        id: connectionId,
        name: 'SQLite database',
        type: 'sqlite',
        capabilities: SQLITE_WORKSPACE_CAPABILITIES,
      },
    ],
    onQueryExecute,
    onSchemaFetch,
    onObjectsFetch: { listContainers, countObjects, listObjects, describeObject },
    features: SQLITE_WORKSPACE_FEATURES,
  };
  return { props, url: connection.url, close: database.close };
}

export type SqliteWorkspace = ReturnType<typeof createSqliteWorkspace>;
