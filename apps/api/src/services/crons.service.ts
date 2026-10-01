import type {
  CronListing,
  CronQuery,
  CronQueryRequest,
  CronQueryResult,
  HostId,
  OwnerId,
} from '@repo/protocol';
import { PendingCronQueries } from '#lib/cron/pending-queries.ts';
import { BadGatewayError, GatewayTimeoutError, NotFoundError } from '#lib/errors.ts';
import type { DeploymentLookup } from '#repositories/deployments.repository.ts';
import { Service } from '#services/service.ts';

type CronReadRequest = Pick<CronQuery, 'appId' | 'deploymentId'> & {
  ownerId: OwnerId;
  signal: AbortSignal;
};

export class CronsService extends Service {
  private readonly deploymentsRepo: DeploymentLookup;
  private readonly pending = new PendingCronQueries();

  constructor({ deploymentsRepo }: { deploymentsRepo: DeploymentLookup }) {
    super();
    this.deploymentsRepo = deploymentsRepo;
  }

  async list({ appId, deploymentId, ownerId, signal }: CronReadRequest): Promise<CronListing> {
    const deployment = await this.deploymentsRepo.findById({ appId, deploymentId, ownerId });
    if (!deployment) {
      throw new NotFoundError('Deployment not found.');
    }
    const { queryId, answered } = this.pending.open({ appId, deploymentId, signal });
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
