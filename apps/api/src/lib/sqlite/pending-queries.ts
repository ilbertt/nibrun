import {
  type HostId,
  type SqliteOutcome,
  type SqliteQuery,
  type SqliteQueryId,
  SqliteQueryIdSchema,
  type SqliteQueryRequest,
  type SqliteQueryResult,
  Value,
} from '@repo/protocol';
import { TooManyRequestsError } from '#lib/errors.ts';

const MAX_PENDING_QUERIES = 1024;
const MAX_PARKED_HOSTS = 1024;

type Answer = { outcome: SqliteOutcome; hostId: HostId };
type Pending = {
  readonly query: SqliteQuery;
  readonly targetHostId: HostId | undefined;
  readonly settle: (answer: Answer) => void;
  claimedBy: HostId | undefined;
};
type Host = SqliteQueryRequest & {
  readonly hostId: HostId;
  readonly hand: (query: SqliteQuery) => void;
};

// SQL operations are never coalesced or replayed; each caller owns exactly one exchange.
export class PendingSqliteQueries {
  readonly #queries = new Map<SqliteQueryId, Pending>();
  readonly #hosts = new Set<Host>();

  open({
    targetHostId,
    signal,
    ...input
  }: Omit<SqliteQuery, 'queryId'> & { targetHostId: HostId | undefined; signal: AbortSignal }) {
    if (this.#queries.size >= MAX_PENDING_QUERIES) {
      throw new TooManyRequestsError('Too many SQLite operations are pending.');
    }
    const query = { ...input, queryId: Value.Parse(SqliteQueryIdSchema, crypto.randomUUID()) };
    const { promise, resolve, reject } = Promise.withResolvers<Answer>();
    const queries = this.#queries;

    function abandon() {
      queries.delete(query.queryId);
      reject(signal.reason);
    }
    function settle(answer: Answer) {
      signal.removeEventListener('abort', abandon);
      resolve(answer);
    }

    const pending: Pending = { query, targetHostId, settle, claimedBy: undefined };
    queries.set(query.queryId, pending);
    signal.addEventListener('abort', abandon, { once: true });
    if (signal.aborted) {
      abandon();
    } else {
      this.#offer(pending);
    }
    return { queryId: query.queryId, answered: promise };
  }

  claim({
    signal,
    ...input
  }: SqliteQueryRequest & { hostId: HostId; signal: AbortSignal }): Promise<
    SqliteQuery | undefined
  > {
    for (const pending of this.#queries.values()) {
      if (eligible({ pending, host: input })) {
        pending.claimedBy = input.hostId;
        return Promise.resolve(pending.query);
      }
    }
    if (signal.aborted) {
      return Promise.resolve(undefined);
    }
    if (this.#hosts.size >= MAX_PARKED_HOSTS) {
      throw new TooManyRequestsError('Too many SQLite hosts are waiting.');
    }
    const { promise, resolve } = Promise.withResolvers<SqliteQuery | undefined>();
    const hosts = this.#hosts;
    const host: Host = {
      ...input,
      hand(query) {
        signal.removeEventListener('abort', leave);
        resolve(query);
      },
    };
    function leave() {
      hosts.delete(host);
      resolve(undefined);
    }
    hosts.add(host);
    signal.addEventListener('abort', leave, { once: true });
    return promise;
  }

  answer({ hostId, queryId, outcome }: SqliteQueryResult & { hostId: HostId }): boolean {
    const pending = this.#queries.get(queryId);
    if (!pending || pending.claimedBy !== hostId) {
      return false;
    }
    this.#queries.delete(queryId);
    pending.settle({ hostId, outcome });
    return true;
  }

  #offer(pending: Pending): void {
    for (const host of this.#hosts) {
      if (eligible({ pending, host })) {
        this.#hosts.delete(host);
        pending.claimedBy = host.hostId;
        host.hand(pending.query);
        return;
      }
    }
  }
}

function eligible({
  pending,
  host,
}: {
  pending: Pending;
  host: SqliteQueryRequest & { hostId: HostId };
}): boolean {
  return (
    pending.claimedBy === undefined &&
    (pending.targetHostId === undefined || pending.targetHostId === host.hostId) &&
    host.servedDeployments.some(function matches(deployment) {
      return (
        deployment.appId === pending.query.appId &&
        deployment.deploymentId === pending.query.deploymentId
      );
    })
  );
}
