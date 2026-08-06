import { type LogRow, lines, toRow } from '#lib/victorialogs/parse.ts';

const TAIL_PATH = '/select/logsql/tail';

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
 * the type offers: `tail.subscribe(…)` names the endpoint and what it does in the same phrase,
 * and an endpoint added later inherits the base URL rather than re-deriving it.
 */
abstract class VictoriaLogsEndpoint {
  private readonly url: string;

  constructor({ baseUrl, path }: { baseUrl: URL; path: string }) {
    this.url = new URL(path, baseUrl).toString();
  }

  protected async post({
    params,
    signal,
  }: {
    params: Record<string, string>;
    signal: AbortSignal;
  }): Promise<Response> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': FORM_CONTENT_TYPE },
      body: new URLSearchParams(params),
      signal,
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

export type TailRequest = {
  /** LogsQL. This endpoint refuses `sort`, `limit`, `offset` and the stats pipes. */
  query: string;
  /** How much history precedes the follow, as a LogsQL duration such as `5m`. */
  startOffset: string;
  signal: AbortSignal;
};

/**
 * Live tailing, rather than a query run over and over: the store follows the stream itself and
 * holds the response open, so nothing here keeps a cursor. It delays new records briefly to let
 * late arrivals land in order, which is why a tail runs a few seconds behind rather than a poll
 * away.
 */
export class VictoriaLogsTail extends VictoriaLogsEndpoint {
  constructor(baseUrl: URL) {
    super({ baseUrl, path: TAIL_PATH });
  }

  async *subscribe({ query, startOffset, signal }: TailRequest): AsyncGenerator<LogRow> {
    const response = await this.post({ params: { query, start_offset: startOffset }, signal });
    if (!response.body) {
      return;
    }
    for await (const line of lines(response.body)) {
      const row = toRow(line);
      if (row) {
        yield row;
      }
    }
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
  readonly tail: VictoriaLogsTail;

  constructor(baseUrl: URL) {
    this.tail = new VictoriaLogsTail(baseUrl);
  }
}
