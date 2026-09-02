const FIRST_GENERATION = 0;
const ONE_CHANGE = 1;

/**
 * Whether a host has been told everything an owner has done, and a way to wait until it has not.
 *
 * A generation rather than the state itself: deciding whether desired state moved by reading it
 * costs the control plane a read of everything the state is made of, on every poll of every host,
 * which is the work holding the request was meant to avoid. Counting the writes instead is exact
 * in the direction that matters — the count moves whenever something might have changed, so a
 * host is never left waiting on news it has already missed.
 *
 * Counting *may have changed* rather than *did* is deliberate. An owner's request that turned out
 * to change nothing a host cares about still moves the count, and the host is answered at once
 * with the state it already holds; `DesiredStateCache` on the far side compares and converges on
 * nothing. The other way round is the one that cannot be allowed — a change nobody counted is a
 * host holding a request for the full hold with the news already sitting in the database.
 *
 * In this process and not in Postgres, for the reason `PendingFilesystemQueries` gives: one api
 * serves the fleet. Sessions live in memory here too, so a second api could not answer a host's
 * poll at all long before it failed to wake one — the day that changes is the day this moves onto
 * a channel both can see, and `LISTEN`/`NOTIFY` is where it goes.
 */
export class DesiredStateNews {
  #generation = FIRST_GENERATION;
  readonly #waiting = new Set<() => void>();
  readonly #served = new Map<string, number>();

  /** Something an owner asked for has landed, so every host holding a poll open is owed a look. */
  changed(): void {
    this.#generation += ONE_CHANGE;
    const waking = [...this.#waiting];
    this.#waiting.clear();
    for (const wake of waking) {
      wake();
    }
  }

  /** What a read taken now would be answering, to be handed back to `served` once it is sent. */
  get generation(): number {
    return this.#generation;
  }

  /**
   * Resolves the moment this session is owed a fresher read than the one it last had, and at once
   * where it already is. `signal` is the request itself: the host going away or the hold expiring
   * both end the wait, and a host arriving with it already fired is answered rather than parked.
   */
  awaited({ sessionToken, signal }: { sessionToken: string; signal: AbortSignal }): Promise<void> {
    if (this.#owed(sessionToken) || signal.aborted) {
      return Promise.resolve();
    }

    const { promise, resolve } = Promise.withResolvers<void>();
    const waiting = this.#waiting;

    function leave() {
      waiting.delete(resolve);
      resolve();
    }

    waiting.add(resolve);
    signal.addEventListener('abort', leave, { once: true });
    return promise;
  }

  /**
   * Taken before the state is read and recorded after it is, so a write landing during the read
   * leaves this session owed another look rather than having been told about it. An extra round
   * trip is the safe end of that to be wrong at.
   */
  served({ sessionToken, generation }: { sessionToken: string; generation: number }): void {
    this.#served.set(sessionToken, generation);
  }

  /** A session nothing has been served to is owed one: it has heard nothing at all yet. */
  #owed(sessionToken: string): boolean {
    return this.#served.get(sessionToken) !== this.#generation;
  }
}
