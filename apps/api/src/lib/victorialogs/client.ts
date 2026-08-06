import { type LogRow, lines, toRow } from '#lib/victorialogs/parse.ts';

const QUERY_PATH = '/select/logsql/query';

/** The store's own name for a query submitted in a body, which is where a filter this long belongs. */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

const MAX_ERROR_BODY = 256;

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
 * and an endpoint added later inherits the base URL rather than re-deriving it.
 */
abstract class VictoriaLogsEndpoint {
  private readonly url: string;

  constructor({ baseUrl, path }: { baseUrl: URL; path: string }) {
    this.url = new URL(path, baseUrl).toString();
  }

  protected async post({ params }: { params: Record<string, string> }): Promise<Response> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': FORM_CONTENT_TYPE },
      body: new URLSearchParams(params),
    });
    if (!response.ok) {
      throw new VictoriaLogsError({
        status: response.status,
        body: (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY),
      });
    }
    return response;
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
 * An ordinary request, and nothing here can cancel one. The endpoint that follows a stream instead
 * exists and would need that — it is held open for as long as someone is reading, so abandoning
 * one without saying so leaks it. A window is bounded by its own `limit` and answers in the time a
 * query takes, which is short enough that a reader who has left costs a reply nobody reads.
 */
export class VictoriaLogsQuery extends VictoriaLogsEndpoint {
  constructor(baseUrl: URL) {
    super({ baseUrl, path: QUERY_PATH });
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
 * Reads the store, and only reads it.
 *
 * Records arrive from the fleet over an ingest listener that admits app hosts and nothing else,
 * so `/insert` is not this process's to call — and the api is the only thing that queries,
 * because deciding who may see an app is its question to answer.
 */
export class VictoriaLogsClient {
  readonly query: VictoriaLogsQuery;

  constructor(baseUrl: URL) {
    this.query = new VictoriaLogsQuery(baseUrl);
  }
}
