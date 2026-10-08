import { Database } from 'bun:sqlite';
import type {
  HranaPipelineReqBody,
  HranaPipelineRespBody,
  HranaStreamRequest,
  HranaStreamResult,
} from '@repo/sqlite';
import { decodeValue, encodeValue } from '#tests/support/hrana-values.ts';

const RESPONSE_DELAY_MS = 5;

export function startDatabaseServer(setup: string) {
  const database = new Database(':memory:', { safeIntegers: true });
  database.exec(setup);
  const statements: string[] = [];
  const headers: Headers[] = [];
  let activeRequests = 0;
  let peakConcurrentRequests = 0;

  function execute(request: HranaStreamRequest): HranaStreamResult {
    if (request.type === 'close') {
      return { type: 'ok', response: { type: 'close' } };
    }
    if (request.type !== 'execute' || !request.stmt.sql) {
      throw new Error('Expected an execute request.');
    }
    statements.push(request.stmt.sql);
    try {
      const statement = database.query(request.stmt.sql);
      const rows = statement.values(...(request.stmt.args ?? []).map(decodeValue));
      return {
        type: 'ok',
        response: {
          type: 'execute',
          result: {
            cols: Array.from(statement.columnNames.entries(), ([index, name]) => ({
              name,
              decltype: statement.declaredTypes[index] ?? null,
            })),
            rows: rows.map((row) => row.map(encodeValue)),
            affected_row_count: 0,
            last_insert_rowid: null,
          },
        },
      };
    } catch (failure) {
      return {
        type: 'error',
        error: {
          message: failure instanceof Error ? failure.message : 'Query failed',
          code:
            failure && typeof failure === 'object' && 'code' in failure
              ? String(failure.code)
              : 'SQLITE_ERROR',
        },
      };
    }
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      activeRequests += 1;
      peakConcurrentRequests = Math.max(peakConcurrentRequests, activeRequests);
      try {
        await Bun.sleep(RESPONSE_DELAY_MS);
        headers.push(request.headers);
        const body = (await request.json()) as HranaPipelineReqBody;
        const response: HranaPipelineRespBody = {
          baton: null,
          base_url: null,
          results: body.requests.map(execute),
        };
        return Response.json(response);
      } finally {
        activeRequests -= 1;
      }
    },
  });

  function close(): void {
    server.stop(true);
    database.close();
  }

  return {
    url: server.url.href,
    statements,
    headers,
    close,
    get peakConcurrentRequests() {
      return peakConcurrentRequests;
    },
  };
}
