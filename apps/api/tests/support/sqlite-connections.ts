import type { AppId, DeploymentId, GuestPath } from '@repo/protocol';
import {
  type HranaPipelineReqBody,
  type HranaPipelineRespBody,
  HranaPipelineSessionContract,
  type HranaStreamRequest,
  type HranaStreamResult,
} from '@repo/sqlite';
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
  const sessions: SqliteConnectionTestSession[] = [];
  return {
    deployment,
    records,
    asked,
    opened,
    sessions,
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
    openSession(input: OpenInput) {
      opened.push(input);
      const session = new SqliteConnectionTestSession();
      sessions.push(session);
      return Promise.resolve(session);
    },
  };
}

class SqliteConnectionTestSession extends HranaPipelineSessionContract {
  readonly pipelines: HranaPipelineReqBody[] = [];
  closed = false;

  override pipeline({
    body,
  }: Parameters<HranaPipelineSessionContract['pipeline']>[0]): Promise<HranaPipelineRespBody> {
    this.pipelines.push(body);
    if (
      body.requests.some(function closing(request) {
        return request.type === 'close';
      })
    ) {
      this.closed = true;
    }
    return Promise.resolve({
      baton: this.closed ? null : 'guest-baton',
      base_url: null,
      results: body.requests.map(response),
    });
  }

  override close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function response(request: HranaStreamRequest): HranaStreamResult {
  if (request.type === 'execute') {
    return {
      type: 'ok',
      response: {
        type: 'execute',
        result: { cols: [], rows: [], affected_row_count: 0, last_insert_rowid: null },
      },
    };
  }
  if (request.type === 'close') {
    return { type: 'ok', response: { type: 'close' } };
  }
  throw new Error('Unexpected request in connection lifecycle tests');
}
