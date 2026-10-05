import type { AppId, DeploymentId, GuestPath } from '@repo/protocol';
import type { SqliteExecutorContract } from '@repo/sqlite';
import { HranaError } from '@repo/sqlite';
import type { OwnerId } from '#lib/api/identifiers.ts';
import type { SqliteConnection } from '#lib/api/sqlite-connection.ts';
import { BadGatewayError, BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import { SQLITE_CONNECTIONS_BASE_PATH } from '#lib/sqlite/routes.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { DeploymentsRepositoryContract } from '#repositories/deployments.repository.ts';
import type {
  DeleteSqliteConnectionInput,
  SqliteConnectionRow,
  SqliteConnectionsByAppInput,
  SqliteConnectionsRepositoryContract,
} from '#repositories/sqlite-connections.repository.ts';
import { Service } from '#services/service.ts';

type OpenSqliteExecutor = (input: {
  appId: AppId;
  deploymentId: DeploymentId;
  path: GuestPath;
  signal: AbortSignal;
}) => Promise<SqliteExecutorContract>;

type SqliteDeploymentsRepositoryContract = Pick<DeploymentsRepositoryContract, 'listByApp'>;

export class SqliteService extends Service {
  private readonly deploymentsRepo: SqliteDeploymentsRepositoryContract;
  private readonly connectionsRepo: SqliteConnectionsRepositoryContract;
  private readonly openExecutor: OpenSqliteExecutor;
  private readonly baseUrl: URL;

  constructor({
    deploymentsRepo,
    connectionsRepo,
    openExecutor,
    baseUrl,
  }: {
    deploymentsRepo: SqliteDeploymentsRepositoryContract;
    connectionsRepo: SqliteConnectionsRepositoryContract;
    openExecutor: OpenSqliteExecutor;
    baseUrl: URL;
  }) {
    super();
    this.deploymentsRepo = deploymentsRepo;
    this.connectionsRepo = connectionsRepo;
    this.openExecutor = openExecutor;
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
      const executor = await this.openExecutor({
        appId,
        deploymentId: deployment.id,
        path: sqlite_file_path,
        signal,
      });
      await executor.close();
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

  async list(input: SqliteConnectionsByAppInput): Promise<SqliteConnection[]> {
    const rows = await this.connectionsRepo.listByApp(input);
    return rows.map((row) => this.toConnection(row));
  }

  async removeConnection(input: DeleteSqliteConnectionInput): Promise<void> {
    if (!(await this.connectionsRepo.remove(input))) {
      throw new NotFoundError('Database connection not found.');
    }
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
