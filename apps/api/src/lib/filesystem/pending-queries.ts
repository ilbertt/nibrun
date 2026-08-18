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

/** A host holding a poll open with nothing in it yet, and the apps it said it can read. */
type ParkedHost = {
  readonly servedAppIds: readonly AppId[];
  readonly hand: (query: FilesystemQuery) => void;
};

export type PendingRead = {
  readonly queryId: FilesystemQueryId;
  readonly answered: Promise<Outcome>;
};

/**
 * The reads somebody is currently waiting on and the hosts currently waiting to be given one, held
 * in the process holding both their requests open.
 *
 * Deliberately not a table. A query is worth exactly as long as its caller stays connected, so it
 * is born and retired inside one request — writing it down would outlive the only thing that gives
 * it meaning and leave rows to sweep after every restart. What that costs is that a host's answer
 * has to reach the same process that asked: one api serves the fleet, and a second one would need
 * this to move onto a channel both can see.
 */
export class PendingFilesystemQueries {
  readonly #reads = new Map<FilesystemQueryId, Read>();
  readonly #parked = new Set<ParkedHost>();

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
    } else {
      this.#offer(read);
    }

    return { queryId: read.query.queryId, answered: promise };
  }

  /**
   * The read that has waited longest among those this host says it can serve — insertion order,
   * so a slow directory delays the people who asked for it rather than the queue behind them — or,
   * when there is none, the first one to open while this host waits here for it.
   *
   * Waiting is the point. A host answered with nothing comes back on a timer of its own, so a read
   * opening a moment after one poll was looked at only on the next; held here it goes down a
   * request the host already has open, and what a person browsing waits for is one round trip.
   * `signal` is that request: it ends the wait when the host goes away or its hold expires, and a
   * host arriving with it already fired takes what is standing rather than waiting for more.
   *
   * Handed out once. A second host taking the same query would read a filesystem for a request
   * another host is already finishing, and only one answer per id can arrive.
   */
  claim({
    servedAppIds,
    signal,
  }: {
    servedAppIds: readonly AppId[];
    signal: AbortSignal;
  }): Promise<FilesystemQuery | undefined> {
    const standing = this.#standingFor(servedAppIds);
    if (standing) {
      standing.claimed = true;
      return Promise.resolve(standing.query);
    }

    const { promise, resolve } = Promise.withResolvers<FilesystemQuery | undefined>();
    const host: ParkedHost = { servedAppIds, hand: resolve };
    const parked = this.#parked;

    function leave() {
      parked.delete(host);
      resolve(undefined);
    }

    parked.add(host);
    signal.addEventListener('abort', leave, { once: true });
    if (signal.aborted) {
      leave();
    }

    return promise;
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
   * A host parked on this app is holding a poll open with nothing in it, so the read goes down
   * that poll now rather than waiting to be asked for again.
   *
   * Woken by the read that concerns it and by nothing else: a host is handed a query for an app it
   * said it serves, so a busy tenant cannot wake the fleet. A read a host is already reading is
   * past this, which is what keeps a claim a claim.
   */
  #offer(read: Read): void {
    if (read.claimed) {
      return;
    }
    for (const host of this.#parked) {
      if (host.servedAppIds.includes(read.query.appId)) {
        this.#parked.delete(host);
        read.claimed = true;
        host.hand(read.query);
        return;
      }
    }
  }

  #standingFor(servedAppIds: readonly AppId[]): Read | undefined {
    for (const read of this.#reads.values()) {
      if (!read.claimed && servedAppIds.includes(read.query.appId)) {
        return read;
      }
    }
    return undefined;
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
