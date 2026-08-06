import {
  type AppId,
  type FilesystemQuery,
  type FilesystemQueryId,
  FilesystemQueryIdSchema,
  type FilesystemQueryResult,
  type GuestPath,
  Value,
} from '@repo/protocol';

type Outcome = FilesystemQueryResult['outcome'];

type Waiter = (outcome: Outcome) => void;

type Read = {
  readonly query: FilesystemQuery;
  readonly waiting: Set<Waiter>;
  claimed: boolean;
};

export type PendingRead = {
  readonly queryId: FilesystemQueryId;
  readonly answered: Promise<Outcome>;
};

/**
 * The reads somebody is currently waiting on, held in the process holding their requests open.
 *
 * Deliberately not a table. A query is worth exactly as long as its caller stays connected, so it
 * is born and retired inside one request — writing it down would outlive the only thing that gives
 * it meaning and leave rows to sweep after every restart. What that costs is that a host's answer
 * has to reach the same process that asked: one api serves the fleet, and a second one would need
 * this to move onto a channel both can see.
 */
export class PendingFilesystemQueries {
  readonly #reads = new Map<FilesystemQueryId, Read>();

  /**
   * Callers asking for the same directory at the same time wait on one read rather than one each.
   *
   * This is the only place that can do it: the control plane holds every waiter, while a host is
   * handed one query at a time and could never see that two of them were the same. Doing it there
   * would mean caching a listing and deciding how stale is too stale, and the second caller would
   * still pay a full poll — here they are answered in the same instant as the first.
   *
   * A read already handed to a host is joined too, and that is where most of the saving is: the
   * host is reading that exact directory right now, so its answer is the one to wait for rather
   * than a reason to ask for a second read of it.
   */
  open({
    appId,
    path,
    signal,
  }: {
    appId: AppId;
    path: GuestPath;
    signal: AbortSignal;
  }): PendingRead {
    const read = this.#readOf({ appId, path });
    const { promise, resolve, reject } = Promise.withResolvers<Outcome>();
    const reads = this.#reads;

    // A read outlives any one of its callers and none of them all: the last to leave takes it
    // with them, so a host is never sent to a device for a request nobody is holding open.
    function giveUp() {
      read.waiting.delete(resolve);
      if (read.waiting.size === 0) {
        reads.delete(read.query.queryId);
      }
      reject(signal.reason);
    }

    read.waiting.add(resolve);
    signal.addEventListener('abort', giveUp, { once: true });
    if (signal.aborted) {
      giveUp();
    }

    return { queryId: read.query.queryId, answered: promise };
  }

  /**
   * The read that has waited longest among those this host says it can serve — insertion order,
   * so a slow directory delays the people who asked for it rather than the queue behind them.
   *
   * Handed out once. A second host taking the same query would read a filesystem for a request
   * another host is already finishing, and only one answer per id can arrive.
   */
  claim({ servedAppIds }: { servedAppIds: readonly AppId[] }): FilesystemQuery | undefined {
    for (const read of this.#reads.values()) {
      if (!read.claimed && servedAppIds.includes(read.query.appId)) {
        read.claimed = true;
        return read.query;
      }
    }
    return undefined;
  }

  /** Whether anyone was still waiting — a host that answered after they left is not an error. */
  answer({ queryId, outcome }: FilesystemQueryResult): boolean {
    const read = this.#reads.get(queryId);
    if (!read) {
      return false;
    }
    this.#reads.delete(queryId);
    for (const settle of read.waiting) {
      settle(outcome);
    }
    return true;
  }

  /**
   * Scanned rather than indexed by directory. What bounds this is how many directories are being
   * looked at right now, which is people rather than files — and a second map to keep true across
   * every join, abort and answer is where this would go wrong long before the scan is felt.
   */
  #readOf({ appId, path }: { appId: AppId; path: GuestPath }): Read {
    for (const read of this.#reads.values()) {
      if (read.query.appId === appId && read.query.path === path) {
        return read;
      }
    }
    const query = {
      queryId: Value.Parse(FilesystemQueryIdSchema, crypto.randomUUID()),
      appId,
      path,
    };
    const read: Read = { query, waiting: new Set(), claimed: false };
    this.#reads.set(query.queryId, read);
    return read;
  }
}
