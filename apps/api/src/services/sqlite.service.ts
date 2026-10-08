import type { AppId, DeploymentId, GuestPath } from '@repo/protocol';
import type { HranaPipelineSessionContract } from '@repo/sqlite';
import { HranaError, HranaPipelineRelay, HranaStreams } from '@repo/sqlite';
import type { OwnerId, SqliteConnectionId } from '#lib/api/identifiers.ts';
import type { SqliteConnection } from '#lib/api/sqlite-connection.ts';
import { BadGatewayError, BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import { SQLITE_CONNECTIONS_BASE_PATH } from '#lib/sqlite/routes.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { DeploymentsRepositoryContract } from '#repositories/deployments.repository.ts';
import type {
  DeleteSqliteConnectionInput,
  SqliteConnectionByIdInput,
  SqliteConnectionRow,
  SqliteConnectionsByAppInput,
  SqliteConnectionsRepositoryContract,
} from '#repositories/sqlite-connections.repository.ts';
import { Service } from '#services/service.ts';

type OpenSqliteSession = (input: {
  appId: AppId;
  deploymentId: DeploymentId;
  path: GuestPath;
  signal: AbortSignal;
}) => Promise<HranaPipelineSessionContract>;

type SqliteDeploymentsRepositoryContract = Pick<DeploymentsRepositoryContract, 'listByApp'>;

export class SqliteService extends Service {
  private readonly deploymentsRepo: SqliteDeploymentsRepositoryContract;
  private readonly connectionsRepo: SqliteConnectionsRepositoryContract;
  private readonly openSession: OpenSqliteSession;
  private readonly baseUrl: URL;
  private readonly streams = new HranaStreams({ limit: undefined, idleTimeoutMs: undefined });
  private readonly pipelineRelay = new HranaPipelineRelay(this.streams);

  constructor({
    deploymentsRepo,
    connectionsRepo,
    openSession,
    baseUrl,
  }: {
    deploymentsRepo: SqliteDeploymentsRepositoryContract;
    connectionsRepo: SqliteConnectionsRepositoryContract;
    openSession: OpenSqliteSession;
    baseUrl: URL;
  }) {
    super();
    this.deploymentsRepo = deploymentsRepo;
    this.connectionsRepo = connectionsRepo;
    this.openSession = openSession;
    this.baseUrl = baseUrl;
  }

  async create({
    appId,
    ownerId,
    sqlite_file_path,
    signal,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    sqlite_file_path: GuestPath;
    signal: AbortSignal;
  }): Promise<SqliteConnection> {
    const deployment = await this.runningDeployment({ appId, ownerId });
    try {
      const session = await this.openSession({
        appId,
        deploymentId: deployment.id,
        path: sqlite_file_path,
        signal,
      });
      await session.close();
      signal.throwIfAborted();
      const current = await this.runningDeployment({ appId, ownerId });
      if (current.id !== deployment.id) {
        throw new ConflictError('The app redeployed while the database was being checked.');
      }
      const row = await this.connectionsRepo.create({ appId, ownerId, path: sqlite_file_path });
      if (!row) {
        throw new NotFoundError('App not found.');
      }
      return this.toConnection(row);
    } catch (error) {
      if (error instanceof HranaError) {
        throw error.code.startsWith('SQLITE_')
          ? new BadRequestError(error.message)
          : new BadGatewayError(error.message);
      }
      throw error;
    }
  }

  async getConnection(input: SqliteConnectionByIdInput): Promise<SqliteConnection> {
    return this.toConnection(await this.findConnection(input));
  }

  async list(input: SqliteConnectionsByAppInput): Promise<SqliteConnection[]> {
    const rows = await this.connectionsRepo.listByApp(input);
    return rows.map((row) => this.toConnection(row));
  }

  async removeConnection(input: DeleteSqliteConnectionInput): Promise<void> {
    if (!(await this.connectionsRepo.remove(input))) {
      throw new NotFoundError('Database connection not found.');
    }
    await this.closeConnectionStreams(input);
  }

  async checkConnection(input: SqliteConnectionByIdInput): Promise<void> {
    await this.connected(input);
  }

  async pipeline({
    id,
    ownerId,
    body,
    signal,
  }: SqliteConnectionByIdInput & {
    body: unknown;
    signal: AbortSignal;
  }) {
    const { connection, deployment } = await this.connected({ id, ownerId });
    const prefix = connectionScopePrefix({ id, ownerId });
    const scope = `${prefix}${deployment.id}`;
    await this.streams.closeScopes({
      matches(candidate) {
        return candidate.startsWith(prefix) && candidate !== scope;
      },
    });
    const openSession = this.openSession;
    function open({ signal }: { signal: AbortSignal }) {
      return openSession({
        appId: connection.app_id,
        deploymentId: deployment.id,
        path: connection.sqlite_file_path,
        signal,
      });
    }
    return await this.pipelineRelay.handle({ body, scope, open, signal });
  }

  private async findConnection(input: SqliteConnectionByIdInput): Promise<SqliteConnectionRow> {
    const connection = await this.connectionsRepo.findById(input);
    if (!connection) {
      throw new NotFoundError('Database connection not found.');
    }
    return connection;
  }

  private async connected(input: SqliteConnectionByIdInput) {
    try {
      const connection = await this.findConnection(input);
      const deployment = await this.runningDeployment({
        appId: connection.app_id,
        ownerId: input.ownerId,
      });
      return { connection, deployment };
    } catch (error) {
      await this.closeConnectionStreams(input);
      throw error;
    }
  }

  private async closeConnectionStreams(input: SqliteConnectionByIdInput): Promise<void> {
    const prefix = connectionScopePrefix(input);
    await this.streams.closeScopes({
      matches(scope) {
        return scope.startsWith(prefix);
      },
    });
  }

  private async runningDeployment(input: SqliteConnectionsByAppInput) {
    const deployments = await this.deploymentsRepo.listByApp(input);
    if (deployments.length === 0) {
      throw new NotFoundError('App deployment not found.');
    }
    const deployment = deployments.find(function running(row) {
      return row.state === 'running';
    });
    if (!deployment) {
      throw new ConflictError('The app needs a running deployment to query its databases.');
    }
    return deployment;
  }

  private toConnection(row: SqliteConnectionRow): SqliteConnection {
    return {
      id: row.id,
      appId: row.app_id,
      sqlite_file_path: row.sqlite_file_path,
      createdAt: toTimestamp(row.created_at),
      url: new URL(`${SQLITE_CONNECTIONS_BASE_PATH}${row.id}/`, this.baseUrl).href,
    };
  }
}

function connectionScopePrefix({
  id,
  ownerId,
}: {
  id: SqliteConnectionId;
  ownerId: OwnerId;
}): string {
  return `${JSON.stringify([ownerId, id])}:`;
}
