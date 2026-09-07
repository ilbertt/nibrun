import { type LogRow, lines, toRow } from '#lib/victorialogs/parse.ts';

const QUERY_PATH = '/select/logsql/query';
const HEALTH_PATH = '/health';

/** The store's own name for a query submitted in a body, which is where a filter this long belongs. */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

const MAX_ERROR_BODY = 256;

/**
 * How long a window has to come back. `fetch` has no deadline of its own, so a store that takes
 * the connection and never answers holds the reader waiting on it — and the log stream asks again
 * every second, so it is a wait nobody is watching for.
 *
 * The whole exchange rather than the first byte: what is read after the headers is one window,
 * capped by its own `limit`, and not something anyone follows.
 */
const QUERY_DEADLINE_MS = 10_000;

/**
 * Shorter, because the answer is only ever wanted inside a budget that is shorter: health gives
 * every probe 2s and calls the component down when one overruns it. Left on the window's
 * deadline the socket would outlive that verdict by the rest of it — on every probe, on every
 * poll of every open dashboard — which is the wait that budget exists to not have.
 */
const HEALTH_DEADLINE_MS = 2_000;

export class VictoriaLogsError extends Error {
  constructor({ status, body }: { status: number; body: string }) {
    super(`the log store answered ${status}: ${body}`);
    this.name = 'VictoriaLogsError';
  }
}

/**
 * One endpoint of the store, holding the URL it resolves to and the one way of asking it.
 *
 * Subclassed per endpoint rather than switched on a path, so what a caller may ask for is what
 * the type offers: `query.run(…)` names the endpoint and what it does in the same phrase,
 * and an endpoint added later inherits the base URL rather than re-deriving it. How long it may
 * take is the endpoint's too — what waits on a window is not what waits on a health probe.
 */
abstract class VictoriaLogsEndpoint {
  private readonly url: string;
  private readonly deadlineMs: number;

  constructor({ baseUrl, path, deadlineMs }: { baseUrl: URL; path: string; deadlineMs: number }) {
    this.url = new URL(path, baseUrl).toString();
    this.deadlineMs = deadlineMs;
  }

  protected async send(init: RequestInit): Promise<Response> {
    const response = await fetch(this.url, {
      ...init,
      signal: AbortSignal.timeout(this.deadlineMs),
    });
    if (!response.ok) {
      throw new VictoriaLogsError({
        status: response.status,
        body: (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY),
      });
    }
    return response;
  }

  protected post({ params }: { params: Record<string, string> }): Promise<Response> {
    return this.send({
      method: 'POST',
      headers: { 'content-type': FORM_CONTENT_TYPE },
      body: new URLSearchParams(params),
    });
  }

  protected get(): Promise<Response> {
    return this.send({ method: 'GET' });
  }
}

export type QueryRequest = {
  /** LogsQL. The window is `start`'s to say, so this carries no `_time` filter of its own. */
  query: string;
  /** Inclusive lower bound of the window, as an ISO 8601 instant. */
  start: string;
};

/**
 * One window of the store, read and finished with.
 *
 * An ordinary request, and no reader here can cancel one. The endpoint that follows a stream
 * instead exists and would need that — it is held open for as long as someone is reading, so
 * abandoning one without saying so leaks it. A window is bounded by its own `limit` and answers in
 * the time a query takes, which is short enough that a reader who has left costs a reply nobody
 * reads. A store that answers nothing at all is the other question, and `send`'s deadline is what
 * bounds that one.
 */
export class VictoriaLogsQuery extends VictoriaLogsEndpoint {
  constructor(baseUrl: URL) {
    super({ baseUrl, path: QUERY_PATH, deadlineMs: QUERY_DEADLINE_MS });
  }

  async run({ query, start }: QueryRequest): Promise<LogRow[]> {
    const response = await this.post({ params: { query, start } });
    if (!response.body) {
      return [];
    }
    const rows: LogRow[] = [];
    for await (const line of lines(response.body)) {
      const row = toRow(line);
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  }
}

/**
 * Whether the store is answering at all, which is a different question from whether a query
 * returns rows: an app that has written nothing has no rows either way.
 */
export class VictoriaLogsHealth extends VictoriaLogsEndpoint {
  constructor(baseUrl: URL) {
    super({ baseUrl, path: HEALTH_PATH, deadlineMs: HEALTH_DEADLINE_MS });
  }

  async check(): Promise<void> {
    await this.get();
  }
}

/**
 * Reads the store, and only reads it.
 *
 * Records arrive from the fleet over an ingest listener that admits app hosts and nothing else,
 * so `/insert` is not this process's to call — and the api is the only thing that queries,
 * because deciding who may see an app is its question to answer.
 */
export class VictoriaLogsClient {
  readonly query: VictoriaLogsQuery;
  readonly health: VictoriaLogsHealth;

  constructor(baseUrl: URL) {
    this.query = new VictoriaLogsQuery(baseUrl);
    this.health = new VictoriaLogsHealth(baseUrl);
  }
}
