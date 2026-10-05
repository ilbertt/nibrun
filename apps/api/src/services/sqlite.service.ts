import type { AppId, DeploymentId, GuestPath, OwnerId } from '@repo/protocol';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import type { SqliteExecutorContract } from '#lib/hrana/executor.ts';
import { HranaPipelineAdapter } from '#lib/hrana/pipeline.ts';
import { HranaStreams } from '#lib/hrana/streams.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { type SqliteSelection, SqliteSelections } from '#lib/sqlite/selections.ts';
import type { DeploymentsRepositoryContract } from '#repositories/deployments.repository.ts';
import { Service } from '#services/service.ts';

type OpenSqliteExecutor = (input: {
  appId: AppId;
  deploymentId: DeploymentId;
  path: GuestPath;
  signal: AbortSignal;
}) => Promise<SqliteExecutorContract>;

type SqliteDeploymentsRepositoryContract = Pick<
  DeploymentsRepositoryContract,
  'findById' | 'listByApp'
>;

export class SqliteService extends Service {
  private readonly deploymentsRepo: SqliteDeploymentsRepositoryContract;
  private readonly openExecutor: OpenSqliteExecutor;
  private readonly baseUrl: URL;
  private readonly selections = new SqliteSelections();
  private readonly streams = new HranaStreams({ limit: undefined, idleTimeoutMs: undefined });
  private readonly adapter = new HranaPipelineAdapter(this.streams);

  constructor({
    deploymentsRepo,
    openExecutor,
    baseUrl,
  }: {
    deploymentsRepo: SqliteDeploymentsRepositoryContract;
    openExecutor: OpenSqliteExecutor;
    baseUrl: URL;
  }) {
    super();
    this.deploymentsRepo = deploymentsRepo;
    this.openExecutor = openExecutor;
    this.baseUrl = baseUrl;
  }

  async select({
    appId,
    ownerId,
    path,
    signal,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    path: GuestPath;
    signal: AbortSignal;
  }) {
    const deployments = await this.deploymentsRepo.listByApp({ appId, ownerId });
    if (deployments.length === 0) {
      throw new NotFoundError('App deployment not found.');
    }
    const deployment = deployments.find(function running(row) {
      return row.state === 'running';
    });
    if (!deployment) {
      throw new ConflictError('The app needs a running deployment to query its databases.');
    }
    const selection = this.selections.create({
      appId,
      deploymentId: deployment.id,
      ownerId,
      path,
      nowMs: Date.now(),
    });
    try {
      const executor = await this.openExecutor({ ...selection, signal });
      await executor.close();
      signal.throwIfAborted();
      await this.authorize(selection);
      return {
        id: selection.id,
        appId,
        deploymentId: selection.deploymentId,
        path,
        expiresAt: new Date(selection.expiresAt).toISOString(),
        url: new URL(`${RoutePrefix.Api}/sqlite/connections/${selection.id}/`, this.baseUrl).href,
      };
    } catch (error) {
      this.selections.remove({ id: selection.id, ownerId, nowMs: Date.now() });
      throw error;
    }
  }

  async closeSelection({ id, ownerId }: { id: string; ownerId: OwnerId }): Promise<void> {
    this.selections.remove({ id, ownerId, nowMs: Date.now() });
    await this.streams.closeScope(selectionScope({ id, ownerId }));
  }

  async checkSelection({ id, ownerId }: { id: string; ownerId: OwnerId }): Promise<void> {
    await this.selected({ id, ownerId });
  }

  async pipeline({
    id,
    ownerId,
    body,
    signal,
  }: {
    id: string;
    ownerId: OwnerId;
    body: unknown;
    signal: AbortSignal;
  }) {
    const selection = await this.selected({ id, ownerId });
    const openExecutor = this.openExecutor;
    function open({ signal }: { signal: AbortSignal }) {
      return openExecutor({ ...selection, signal });
    }
    return await this.adapter.handle({ body, scope: selectionScope(selection), open, signal });
  }

  private async selected(input: { id: string; ownerId: OwnerId }): Promise<SqliteSelection> {
    try {
      const selection = this.selections.get({ ...input, nowMs: Date.now() });
      await this.authorize(selection);
      return selection;
    } catch (error) {
      await this.streams.closeScope(selectionScope(input));
      throw error;
    }
  }

  private async authorize(selection: SqliteSelection): Promise<void> {
    const deployment = await this.deploymentsRepo.findById(selection);
    if (!deployment) {
      throw new NotFoundError('App deployment not found.');
    }
    if (deployment.state !== 'running') {
      throw new ConflictError('The selected database deployment is no longer running.');
    }
  }
}

function selectionScope({ id, ownerId }: { id: string; ownerId: OwnerId }): string {
  return JSON.stringify([ownerId, id]);
}
