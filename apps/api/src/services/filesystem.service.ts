import type {
  AppId,
  DeploymentId,
  DirectoryListing,
  FilesystemQuery,
  FilesystemQueryResult,
  GuestPath,
  HostId,
} from '@repo/protocol';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { BadGatewayError, ConflictError, GatewayTimeoutError, NotFoundError } from '#lib/errors.ts';
import { PendingFilesystemQueries } from '#lib/filesystem/pending-queries.ts';
import type { DeploymentHostsRepositoryContract } from '#repositories/deployment-hosts.repository.ts';
import type { DeploymentLookupRepositoryContract } from '#repositories/deployments.repository.ts';
import { Service } from '#services/service.ts';

// A deployment the caller does not own has to be indistinguishable from one that does not exist.
const NO_SUCH_DEPLOYMENT = 'Deployment not found.';

/**
 * The host's own words are for an operator, not for whoever asked: they name the device it failed
 * to read, which is a host's business and not a tenant's. They are logged and this is answered.
 *
 * It also stays vague because the host cannot be more precise. A directory that is not there and a
 * device that cannot be read both come back as nothing read, so saying "no such directory" here
 * would send somebody hunting for a file they still have.
 */
const UNREADABLE = 'That directory could not be read.';

const UNANSWERED = 'No host holding this filesystem answered in time.';

export type DirectoryReadRequest = {
  appId: AppId;
  deploymentId: DeploymentId;
  ownerId: OwnerId;
  path: GuestPath;
};

export class FilesystemService extends Service {
  private readonly deploymentsRepo: DeploymentLookupRepositoryContract;
  private readonly deploymentHostsRepo: DeploymentHostsRepositoryContract;
  private readonly pending = new PendingFilesystemQueries();

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

  /**
   * Asks the fleet for one directory and waits for the answer, because there is nowhere to read it
   * from: no host is ever connected to, so a read happens on a request the host that holds the
   * volume is holding open in the hope of one. This request stays open across that round trip.
   *
   * The deployment decides who may read, not what is read — the filesystem belongs to the app and
   * outlives every release of it. It is looked up rather than the app because a deployment under
   * another owner's app must not become readable by naming this owner's app in the path.
   */
  async readDirectory({
    appId,
    deploymentId,
    ownerId,
    path,
    signal,
  }: DirectoryReadRequest & { signal: AbortSignal }): Promise<DirectoryListing> {
    const deployment = await this.deploymentsRepo.findById({ appId, deploymentId, ownerId });
    if (!deployment) {
      throw new NotFoundError(NO_SUCH_DEPLOYMENT);
    }

    const execution = await this.deploymentHostsRepo.currentForApp({ appId, ownerId });
    if (execution === null) {
      throw new ConflictError('This app has no assigned execution host.');
    }
    const { queryId, answered } = this.pending.open({
      appId,
      path,
      signal,
      target: { hostId: execution.host_id, deploymentId: execution.deployment_id },
    });
    const outcome = await answered.catch(() => {
      this.logger.warn('no host answered a directory read', { queryId, appId });
      throw new GatewayTimeoutError(UNANSWERED);
    });

    if (outcome.status === 'failed') {
      this.logger.warn('host could not read a directory', {
        queryId,
        appId,
        message: outcome.message,
      });
      throw new BadGatewayError(UNREADABLE);
    }
    return outcome.listing;
  }

  pendingQuery({
    servedAppIds,
    signal,
    hostId,
  }: {
    servedAppIds: readonly AppId[];
    signal: AbortSignal;
    hostId: HostId;
  }): Promise<FilesystemQuery | undefined> {
    return this.pending.claim({ servedAppIds, signal, hostId });
  }

  acceptResult(result: FilesystemQueryResult & { hostId: HostId }): void {
    if (!this.pending.answer(result)) {
      this.logger.info('a directory was read for a request that had already ended', {
        queryId: result.queryId,
      });
    }
  }
}
