import type { SqliteExecutorContract } from '#executor.ts';
import { HranaError } from '#hrana-error.ts';

const DEFAULT_STREAM_LIMIT = 64;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

type OpenExecutor = (input: { signal: AbortSignal }) => Promise<SqliteExecutorContract>;

export type HranaStream = {
  readonly scope: string;
  readonly executor: SqliteExecutorContract;
  readonly storedSql: Map<number, string>;
  closed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export class HranaStreams {
  readonly #batons = new Map<string, HranaStream>();
  readonly #live = new Set<HranaStream>();
  readonly #limit: number;
  readonly #idleTimeoutMs: number;
  readonly #opening = new Set<{ scope: string; invalidated: boolean }>();
  #disposed = false;

  constructor({
    limit = DEFAULT_STREAM_LIMIT,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  }: {
    limit: number | undefined;
    idleTimeoutMs: number | undefined;
  }) {
    this.#limit = limit;
    this.#idleTimeoutMs = idleTimeoutMs;
  }

  async acquire({
    baton,
    scope,
    open,
    signal,
  }: {
    baton: string | null;
    scope: string;
    open: OpenExecutor;
    signal: AbortSignal;
  }): Promise<HranaStream> {
    signal.throwIfAborted();
    if (this.#disposed) {
      throw new HranaError({ message: 'Stream store is closed', code: 'STREAM_CLOSED' });
    }
    if (baton !== null) {
      const stream = this.#batons.get(baton);
      if (!stream || stream.scope !== scope) {
        throw new HranaError({ message: 'Stream is invalid or expired', code: 'STREAM_EXPIRED' });
      }
      this.#batons.delete(baton);
      clearTimeout(stream.timer);
      stream.timer = undefined;
      return stream;
    }
    return await this.#open({ scope, open, signal });
  }

  release(stream: HranaStream): string | null {
    if (stream.closed) {
      return null;
    }
    const baton = crypto.randomUUID();
    this.#batons.set(baton, stream);
    const streams = this;
    stream.timer = setTimeout(function expire() {
      streams.#batons.delete(baton);
      void streams.close(stream).catch(function ignoreClosedExecutor() {});
    }, this.#idleTimeoutMs);
    stream.timer.unref();
    return baton;
  }

  async close(stream: HranaStream): Promise<void> {
    if (stream.closed) {
      return;
    }
    stream.closed = true;
    clearTimeout(stream.timer);
    this.#live.delete(stream);
    stream.storedSql.clear();
    for (const [baton, candidate] of this.#batons) {
      if (candidate === stream) {
        this.#batons.delete(baton);
      }
    }
    await stream.executor.close();
  }

  async closeScope(scope: string): Promise<void> {
    await this.closeScopes({
      matches(candidate) {
        return candidate === scope;
      },
    });
  }

  async closeScopes({ matches }: { matches: (scope: string) => boolean }): Promise<void> {
    for (const opening of this.#opening) {
      if (matches(opening.scope)) {
        opening.invalidated = true;
      }
    }
    const streams = [...this.#live].filter(function matchesScope(stream) {
      return matches(stream.scope);
    });
    await this.#closeMany(streams);
  }

  async closeAll(): Promise<void> {
    this.#disposed = true;
    for (const opening of this.#opening) {
      opening.invalidated = true;
    }
    await this.#closeMany([...this.#live]);
  }

  async #closeMany(streams: HranaStream[]): Promise<void> {
    const store = this;
    const results = await Promise.allSettled(
      streams.map(function closeStream(stream) {
        return store.close(stream);
      }),
    );
    const errors = results.flatMap(function failure(result) {
      return result.status === 'rejected' ? [result.reason] : [];
    });
    if (errors.length > 0) {
      throw new AggregateError(errors, 'SQLite streams failed to close');
    }
  }

  async #open({
    scope,
    open,
    signal,
  }: {
    scope: string;
    open: OpenExecutor;
    signal: AbortSignal;
  }): Promise<HranaStream> {
    if (this.#live.size + this.#opening.size >= this.#limit) {
      throw new HranaError({ message: 'Too many SQLite streams', code: 'STREAM_LIMIT' });
    }
    const opening = { scope, invalidated: false };
    this.#opening.add(opening);
    try {
      const executor = await open({ signal });
      const stream: HranaStream = {
        scope,
        executor,
        storedSql: new Map(),
        closed: false,
        timer: undefined,
      };
      this.#live.add(stream);
      if (signal.aborted || opening.invalidated) {
        await this.close(stream);
        signal.throwIfAborted();
        throw new HranaError({
          message: 'Stream was invalidated while opening',
          code: 'STREAM_EXPIRED',
        });
      }
      return stream;
    } finally {
      this.#opening.delete(opening);
    }
  }
}
