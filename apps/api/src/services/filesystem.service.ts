import type {
  AppId,
  DeploymentId,
  DirectoryListing,
  FilesystemQuery,
  FilesystemQueryResult,
  GuestPath,
  OwnerId,
} from '@repo/protocol';
import { BadGatewayError, GatewayTimeoutError, NotFoundError } from '#lib/errors.ts';
import { PendingFilesystemQueries } from '#lib/filesystem/pending-queries.ts';
import type { DeploymentLookup } from '#repositories/deployments.repository.ts';
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
  private readonly deploymentsRepo: DeploymentLookup;
  private readonly pending = new PendingFilesystemQueries();

  constructor({ deploymentsRepo }: { deploymentsRepo: DeploymentLookup }) {
    super();
    this.deploymentsRepo = deploymentsRepo;
  }

  /**
   * Asks the fleet for one directory and waits for the answer, because there is nowhere to read it
   * from: no host is ever connected to, so a read only happens when the host that holds the volume
   * next asks whether there is anything to do. The request stays open across that round trip.
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

    const { queryId, answered } = this.pending.open({ appId, path, signal });
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

  /**
   * Offered only to a host that says it serves the app. The claim is the host's, restated on each
   * poll: it is the only party that knows what it has attached, and a control plane deciding this
   * from its own records would keep sending reads to a host that no longer holds the volume.
   */
  pendingQuery({ servedAppIds }: { servedAppIds: readonly AppId[] }): FilesystemQuery | undefined {
    return this.pending.claim({ servedAppIds });
  }

  acceptResult(result: FilesystemQueryResult): void {
    if (!this.pending.answer(result)) {
      this.logger.info('a directory was read for a request that had already ended', {
        queryId: result.queryId,
      });
    }
  }
}
