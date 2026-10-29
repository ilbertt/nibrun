import type {
  CronListing,
  CronQuery,
  CronQueryRequest,
  CronQueryResult,
  HostId,
} from '@repo/protocol';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { PendingCronQueries } from '#lib/cron/pending-queries.ts';
import { BadGatewayError, ConflictError, GatewayTimeoutError, NotFoundError } from '#lib/errors.ts';
import type { DeploymentHostsRepositoryContract } from '#repositories/deployment-hosts.repository.ts';
import type { DeploymentLookupRepositoryContract } from '#repositories/deployments.repository.ts';
import { Service } from '#services/service.ts';

type CronReadRequest = Pick<CronQuery, 'appId' | 'deploymentId'> & {
  ownerId: OwnerId;
  signal: AbortSignal;
};

export class CronsService extends Service {
  private readonly deploymentsRepo: DeploymentLookupRepositoryContract;
  private readonly deploymentHostsRepo: DeploymentHostsRepositoryContract;
  private readonly pending = new PendingCronQueries();

  constructor({
    deploymentsRepo,
    deploymentHostsRepo,
  }: {
    deploymentsRepo: DeploymentLookupRepositoryContract;
    deploymentHostsRepo: DeploymentHostsRepositoryContract;
  }) {
    super();
    this.deploymentsRepo = deploymentsRepo;
    this.deploymentHostsRepo = deploymentHostsRepo;
  }

  async list({ appId, deploymentId, ownerId, signal }: CronReadRequest): Promise<CronListing> {
    const deployment = await this.deploymentsRepo.findById({ appId, deploymentId, ownerId });
    if (!deployment) {
      throw new NotFoundError('Deployment not found.');
    }
    const execution = await this.deploymentHostsRepo.currentForApp({ appId, ownerId });
    if (execution?.deployment_id !== deploymentId) {
      throw new ConflictError('This deployment has no current execution host.');
    }
    const { queryId, answered } = this.pending.open({
      appId,
      deploymentId,
      signal,
      targetHostId: execution.host_id,
    });
    const outcome = await answered.catch(() => {
      this.logger.warn('no host answered a cron read', { queryId, appId, deploymentId });
      throw new GatewayTimeoutError('No host holding these cron registrations answered in time.');
    });
    if (outcome.status === 'failed') {
      this.logger.warn('host could not list crons', {
        queryId,
        appId,
        deploymentId,
        message: outcome.message,
      });
      throw new BadGatewayError('Cron registrations could not be read.');
    }
    return outcome.listing;
  }

  pendingQuery(input: CronQueryRequest & { hostId: HostId; signal: AbortSignal }) {
    return this.pending.claim(input);
  }

  acceptResult(input: CronQueryResult & { hostId: HostId }): void {
    if (!this.pending.answer(input)) {
      this.logger.info('cron response did not match a pending read', {
        queryId: input.queryId,
        hostId: input.hostId,
      });
    }
  }
}
