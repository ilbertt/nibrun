import type { AppId, DeploymentId, OwnerId, TenantLogRecord } from '@repo/protocol';
import { NotFoundError } from '#lib/errors.ts';
import type { DeploymentsRepositoryContract } from '#repositories/deployments.repository.ts';
import type { LogsRepositoryContract } from '#repositories/logs.repository.ts';
import { Service } from '#services/service.ts';

// A deployment the caller does not own has to be indistinguishable from one that does not exist.
const NO_SUCH_DEPLOYMENT = 'Deployment not found.';

export type DeploymentLookup = Pick<DeploymentsRepositoryContract, 'findById'>;

export type TenantLogTailRequest = {
  appId: AppId;
  deploymentId: DeploymentId;
  ownerId: OwnerId;
  startOffset: string;
};

export class LogsService extends Service {
  private readonly logsRepo: LogsRepositoryContract;
  private readonly deploymentsRepo: DeploymentLookup;

  constructor({
    logsRepo,
    deploymentsRepo,
  }: {
    logsRepo: LogsRepositoryContract;
    deploymentsRepo: DeploymentLookup;
  }) {
    super();
    this.logsRepo = logsRepo;
    this.deploymentsRepo = deploymentsRepo;
  }

  /**
   * Resolves who may read before it returns anything to read from, so a caller who owns nothing
   * is answered rather than connected to. The check is Postgres' — the log store holds no owner
   * — and it is made once, at the point the stream opens: a connection held open past a transfer
   * keeps the access it was granted, which is what bounds how long the route lets one live.
   *
   * The deployment is looked up rather than the app, because a deployment belonging to another
   * owner's app must not be readable by naming this owner's app in the path.
   */
  async openTail({
    appId,
    deploymentId,
    ownerId,
    startOffset,
    signal,
  }: TenantLogTailRequest & { signal: AbortSignal }): Promise<AsyncIterable<TenantLogRecord>> {
    const deployment = await this.deploymentsRepo.findById({ appId, deploymentId, ownerId });
    if (!deployment) {
      throw new NotFoundError(NO_SUCH_DEPLOYMENT);
    }
    this.logger.info('tenant log tail opened', { appId, deploymentId, startOffset });
    return this.logsRepo.tail({ appId, deploymentId, startOffset, signal });
  }
}
