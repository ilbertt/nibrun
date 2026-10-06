import {
  type CronQuery,
  type CronQueryId,
  CronQueryIdSchema,
  type CronQueryRequest,
  type CronQueryResult,
  type HostId,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';

type Deployment = Pick<CronQuery, 'appId' | 'deploymentId'>;
type Outcome = CronQueryResult['outcome'];
type Waiter = (outcome: Outcome) => void;
type Read = {
  readonly query: CronQuery;
  readonly waiting: Set<Waiter>;
  claimedBy: HostId | undefined;
};
type ParkedHost = CronQueryRequest & {
  readonly hostId: HostId;
  readonly hand: (query: CronQuery) => void;
};

// Queries live only while callers wait; answers must return to the API process holding them.
export class PendingCronQueries {
  readonly #reads = new Map<CronQueryId, Read>();
  readonly #parked = new Set<ParkedHost>();

  open({ signal, ...deployment }: Deployment & { signal: AbortSignal }) {
    const read = this.#readOf(deployment);
    const { promise, resolve, reject } = Promise.withResolvers<Outcome>();
    const reads = this.#reads;

    function settle(outcome: Outcome) {
      signal.removeEventListener('abort', giveUp);
      resolve(outcome);
    }

    function giveUp() {
      read.waiting.delete(settle);
      if (read.waiting.size === 0) {
        reads.delete(read.query.queryId);
      }
      reject(signal.reason);
    }

    read.waiting.add(settle);
    signal.addEventListener('abort', giveUp, { once: true });
    if (signal.aborted) {
      giveUp();
    } else {
      this.#offer(read);
    }
    return { queryId: read.query.queryId, answered: promise };
  }

  claim({
    signal,
    ...input
  }: CronQueryRequest & { hostId: HostId; signal: AbortSignal }): Promise<CronQuery | undefined> {
    for (const read of this.#reads.values()) {
      if (
        !read.claimedBy &&
        input.servedDeployments.some((deployment) => matches({ query: read.query, deployment }))
      ) {
        read.claimedBy = input.hostId;
        return Promise.resolve(read.query);
      }
    }
    const { promise, resolve } = Promise.withResolvers<CronQuery | undefined>();
    const parked = this.#parked;
    const host: ParkedHost = {
      ...input,
      hand(query) {
        signal.removeEventListener('abort', leave);
        resolve(query);
      },
    };

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

  answer({ hostId, queryId, outcome }: CronQueryResult & { hostId: HostId }): boolean {
    const read = this.#reads.get(queryId);
    if (!read || read.claimedBy !== hostId) {
      return false;
    }
    if (
      outcome.status === 'listed' &&
      !matches({ query: read.query, deployment: outcome.listing })
    ) {
      return false;
    }
    this.#reads.delete(queryId);
    for (const settle of read.waiting) {
      settle(outcome);
    }
    return true;
  }

  #offer(read: Read): void {
    if (read.claimedBy) {
      return;
    }
    for (const host of this.#parked) {
      if (host.servedDeployments.some((deployment) => matches({ query: read.query, deployment }))) {
        this.#parked.delete(host);
        read.claimedBy = host.hostId;
        host.hand(read.query);
        return;
      }
    }
  }

  #readOf(deployment: Deployment): Read {
    for (const read of this.#reads.values()) {
      if (matches({ query: read.query, deployment })) {
        return read;
      }
    }
    const query = { ...deployment, queryId: Value.Parse(CronQueryIdSchema, crypto.randomUUID()) };
    const read: Read = { query, waiting: new Set(), claimedBy: undefined };
    this.#reads.set(query.queryId, read);
    return read;
  }
}

function matches({ query, deployment }: { query: Deployment; deployment: Deployment }): boolean {
  return query.appId === deployment.appId && query.deploymentId === deployment.deploymentId;
}
