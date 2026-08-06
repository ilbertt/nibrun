import type { AppId, DeploymentId, OwnerId, TenantLogRecord, Timestamp } from '@repo/protocol';
import { durationToMs } from '#lib/duration.ts';
import { NotFoundError } from '#lib/errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import { wait } from '#lib/wait.ts';
import type { DeploymentLookup } from '#repositories/deployments.repository.ts';
import type { LogsRepositoryContract } from '#repositories/logs.repository.ts';
import { Service } from '#services/service.ts';

// A deployment the caller does not own has to be indistinguishable from one that does not exist.
const NO_SUCH_DEPLOYMENT = 'Deployment not found.';

/** Most records one answer carries. A reader that fills it is handed the rest on its next ask. */
const PAGE_LIMIT = 500;

/** How long an answer with nothing in it waits before looking again. */
const IDLE_INTERVAL_MS = 1_000;

const ONE_MS = 1;

export type TenantLogPollRequest = {
  appId: AppId;
  deploymentId: DeploymentId;
  ownerId: OwnerId;
  /** Where to resume. Absent on a first read, which starts `timerange` ago instead. */
  since: Timestamp | undefined;
  timerange: string;
};

export type TenantLogPage = {
  records: TenantLogRecord[];
  cursor: Timestamp;
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
   * One page of a deployment's output, waited for rather than reported empty.
   *
   * A log that is quiet has nothing to answer with and everything to answer with in a moment, so
   * the request is held rather than refused — which is what lets a reader follow an app by asking
   * again and again without either spinning or missing what lands between two asks. What ends the
   * wait is the caller's own signal: they left, or the ceiling above this reached.
   *
   * Ownership is resolved before anything is read, and resolved again on every page, because each
   * page is its own request. The check is Postgres' — the log store holds no owner — and the
   * deployment is what is looked up rather than the app, because a deployment belonging to another
   * owner's app must not be readable by naming this owner's app in the path.
   */
  async poll({
    appId,
    deploymentId,
    ownerId,
    since,
    timerange,
    signal,
  }: TenantLogPollRequest & { signal: AbortSignal }): Promise<TenantLogPage> {
    const deployment = await this.deploymentsRepo.findById({ appId, deploymentId, ownerId });
    if (!deployment) {
      throw new NotFoundError(NO_SUCH_DEPLOYMENT);
    }
    const from = since ?? startOf(timerange);
    this.logger.info('tenant log page opened', { appId, deploymentId, from });

    // An abort reaches the store as a failed fetch rather than an empty answer, and it is the
    // ordinary ending here — every quiet follow reaches the ceiling. The signal decides that, not
    // the error: a reader who left and an expired ceiling raise different exceptions.
    try {
      while (!signal.aborted) {
        const records = await this.logsRepo.read({
          appId,
          deploymentId,
          since: from,
          limit: PAGE_LIMIT,
          signal,
        });
        if (records.length > 0) {
          return { records, cursor: resumeAt({ records, from }) };
        }
        await wait({ ms: IDLE_INTERVAL_MS, signal });
      }
    } catch (error) {
      if (!signal.aborted) {
        throw error;
      }
    }
    return { records: [], cursor: from };
  }
}

function startOf(timerange: string): Timestamp {
  return toTimestamp(new Date(Date.now() - durationToMs(timerange)));
}

/**
 * Where the next page resumes: inclusive of the record it names, or unmoved when there was none.
 *
 * The store stamps to the millisecond, so records sharing the last one's instant may not all have
 * been written when this page was read — resuming past it would lose them, and resuming on it
 * hands the reader a copy of what it already has. A copy is the recoverable half: `sourceId` and
 * `sequence` are on every record precisely so a reader can tell a second copy from a second
 * record.
 *
 * A full page that begins and ends in the same instant is the one case that would resume on
 * itself forever, and it moves on instead. Reaching it means a guest wrote a page of output inside
 * one millisecond, and what is skipped is the remainder of that millisecond.
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
