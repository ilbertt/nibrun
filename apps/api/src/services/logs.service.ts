import {
  type AppId,
  type DeploymentId,
  type OwnerId,
  SeenTenantLogs,
  type TenantLogRecord,
  type Timestamp,
} from '@repo/protocol';
import { durationToMs } from '#lib/duration.ts';
import { NotFoundError } from '#lib/errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import { wait } from '#lib/wait.ts';
import type { DeploymentLookup } from '#repositories/deployments.repository.ts';
import type { LogsRepositoryContract } from '#repositories/logs.repository.ts';
import { Service } from '#services/service.ts';

// A deployment the caller does not own has to be indistinguishable from one that does not exist.
const NO_SUCH_DEPLOYMENT = 'Deployment not found.';

/** Most records one read of the store may answer with. The rest are the next read's. */
const PAGE_LIMIT = 500;

/** How long a read that found nothing waits before looking again. */
const IDLE_INTERVAL_MS = 1_000;

const ONE_MS = 1;

export type TenantLogStreamRequest = {
  appId: AppId;
  deploymentId: DeploymentId;
  ownerId: OwnerId;
  /** How much history precedes the follow. */
  timerange: string;
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
  async openStream({
    appId,
    deploymentId,
    ownerId,
    timerange,
    signal,
  }: TenantLogStreamRequest & { signal: AbortSignal }): Promise<AsyncIterable<TenantLogRecord>> {
    const deployment = await this.deploymentsRepo.findById({ appId, deploymentId, ownerId });
    if (!deployment) {
      throw new NotFoundError(NO_SUCH_DEPLOYMENT);
    }
    this.logger.info('tenant log stream opened', { appId, deploymentId, timerange });
    return this.records({ appId, deploymentId, since: startOf(timerange), signal });
  }

  /**
   * The store is read in windows rather than followed, so what makes this a stream is the loop —
   * ask, hand over what came back, wait, ask again from where that left off. A reader sees a live
   * log; that it is assembled from windows is this service's business and reaches nobody else,
   * which is why the overlap each window carries is dropped here rather than passed on.
   */
  private async *records({
    appId,
    deploymentId,
    since,
    signal,
  }: Pick<TenantLogStreamRequest, 'appId' | 'deploymentId'> & {
    since: Timestamp;
    signal: AbortSignal;
  }): AsyncGenerator<TenantLogRecord> {
    const delivered = new SeenTenantLogs();
    let from = since;

    while (!signal.aborted) {
      const records = await this.logsRepo.read({
        appId,
        deploymentId,
        since: from,
        limit: PAGE_LIMIT,
      });
      const fresh = records.filter((record) => delivered.admit(record));
      for (const record of fresh) {
        yield record;
      }
      from = resumeAt({ records, from });

      if (fresh.length === 0) {
        await wait({ ms: IDLE_INTERVAL_MS, signal });
      }
    }
  }
}

function startOf(timerange: string): Timestamp {
  return toTimestamp(new Date(Date.now() - durationToMs(timerange)));
}

/**
 * Where the next window starts: inclusive of the record it names, or unmoved when there was none.
 *
 * The store stamps to the millisecond, so records sharing the last one's instant may not all have
 * been written when this window was read — starting past it would lose them, and starting on it
 * repeats what has already been handed over. A repeat is the recoverable half, and
 * `SeenTenantLogs` is what recovers it.
 *
 * A full window that begins and ends in the same instant is the one case that would start on
 * itself forever, and it moves on instead. Reaching it means a guest wrote a window of output
 * inside one millisecond, and what is skipped is the remainder of that millisecond.
 */
function resumeAt({ records, from }: { records: TenantLogRecord[]; from: Timestamp }): Timestamp {
  const first = records[0];
  const last = records[records.length - 1];
  if (!(first && last)) {
    return from;
  }
  if (records.length < PAGE_LIMIT || first._time !== last._time) {
    return last._time;
  }
  return toTimestamp(new Date(Date.parse(last._time) + ONE_MS));
}
