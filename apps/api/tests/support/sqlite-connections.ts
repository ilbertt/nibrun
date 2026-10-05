import type { AppId, DeploymentId, GuestPath } from '@repo/protocol';
import { SqliteExecutorContract, type SqliteStatement } from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';
import { SqliteConnectionIdSchema } from '#lib/api/identifiers.ts';
import type { DeploymentRow, DeploymentsByAppInput } from '#repositories/deployments.repository.ts';
import type {
  CreateSqliteConnectionInput,
  DeleteSqliteConnectionInput,
  SqliteConnectionByIdInput,
  SqliteConnectionRow,
  SqliteConnectionsByAppInput,
} from '#repositories/sqlite-connections.repository.ts';
import {
  A_DEPLOYMENT_ROW,
  APP_ID,
  DEPLOYMENT_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';

type OpenInput = { appId: AppId; deploymentId: DeploymentId; path: GuestPath; signal: AbortSignal };

export function sqliteConnectionsFixture() {
  const deployment: DeploymentRow = {
    ...A_DEPLOYMENT_ROW,
    id: DEPLOYMENT_ID,
    app_id: APP_ID,
    state: 'running',
  };
  const records: SqliteConnectionRow[] = [];
  const asked: DeploymentsByAppInput[] = [];
  const opened: OpenInput[] = [];
  const executors: SqliteConnectionTestExecutor[] = [];
  return {
    deployment,
    records,
    asked,
    opened,
    executors,
    baseUrl: new URL('https://api.test'),
    connectionsRepo: {
      create({ appId, ownerId, path }: CreateSqliteConnectionInput) {
        if (ownerId !== OWNER_ID || appId !== APP_ID) {
          return Promise.resolve(null);
        }
        const row = {
          id: Value.Parse(SqliteConnectionIdSchema, crypto.randomUUID()),
          app_id: appId,
          sqlite_file_path: path,
          created_at: new Date(),
        };
        records.push(row);
        return Promise.resolve(row);
      },
      listByApp({ appId, ownerId }: SqliteConnectionsByAppInput) {
        return Promise.resolve(
          ownerId === OWNER_ID ? records.filter((row) => row.app_id === appId) : [],
        );
      },
      findById({ id, ownerId }: SqliteConnectionByIdInput) {
        return Promise.resolve(
          ownerId === OWNER_ID ? (records.find((row) => row.id === id) ?? null) : null,
        );
      },
      remove({ id, ownerId, appId }: DeleteSqliteConnectionInput) {
        const index = records.findIndex(
          (row) => row.id === id && row.app_id === appId && ownerId === OWNER_ID,
        );
        if (index < 0) {
          return Promise.resolve(false);
        }
        records.splice(index, 1);
        return Promise.resolve(true);
      },
    },
    deploymentsRepo: {
      listByApp(input: DeploymentsByAppInput) {
        asked.push(input);
        return Promise.resolve(
          input.ownerId === OWNER_ID && input.appId === APP_ID ? [deployment] : [],
        );
      },
    },
    openExecutor(input: OpenInput) {
      opened.push(input);
      const executor = new SqliteConnectionTestExecutor();
      executors.push(executor);
      return Promise.resolve(executor);
    },
  };
}

class SqliteConnectionTestExecutor extends SqliteExecutorContract {
  readonly statements: SqliteStatement[] = [];
  closed = false;

  override execute({ statement }: Parameters<SqliteExecutorContract['execute']>[0]) {
    this.statements.push(statement);
    return Promise.resolve({
      cols: [],
      rows: [],
      affected_row_count: 0,
      last_insert_rowid: null,
    });
  }

  override describe(
    _input: Parameters<SqliteExecutorContract['describe']>[0],
  ): ReturnType<SqliteExecutorContract['describe']> {
    throw new Error('Unexpected description in connection lifecycle tests');
  }

  override sequence(
    _input: Parameters<SqliteExecutorContract['sequence']>[0],
  ): ReturnType<SqliteExecutorContract['sequence']> {
    throw new Error('Unexpected sequence in connection lifecycle tests');
  }

  override close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
