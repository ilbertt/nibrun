import type { HranaStreamRequest } from '@repo/protocol';
import { executeHranaBatch } from '#lib/hrana/batch.ts';
import { HranaError, hranaError } from '#lib/hrana/errors.ts';
import type { SqliteExecutorContract } from '#lib/hrana/executor.ts';
import { hranaDescribeResult, hranaStatementResult } from '#lib/hrana/results.ts';
import { parseHranaPipeline } from '#lib/hrana/schema.ts';
import { hranaStatement, resolveHranaSql } from '#lib/hrana/sql.ts';
import type { HranaStream, HranaStreams } from '#lib/hrana/streams.ts';

const MAX_STORED_SQL = 30;
const MAX_RESPONSE_BYTES = 4_194_304;

type StreamResponse =
  | { type: 'execute'; result: ReturnType<typeof hranaStatementResult> }
  | { type: 'batch'; result: Awaited<ReturnType<typeof executeHranaBatch>> }
  | { type: 'describe'; result: ReturnType<typeof hranaDescribeResult> }
  | { type: 'sequence' | 'store_sql' | 'close_sql' | 'close' };

type StreamResult =
  | { type: 'ok'; response: StreamResponse }
  | { type: 'error'; error: ReturnType<typeof hranaError> };

export type HranaPipelineResponse = {
  baton: string | null;
  base_url: null;
  results: StreamResult[];
};

export class HranaPipelineAdapter {
  readonly #streams: HranaStreams;

  constructor(streams: HranaStreams) {
    this.#streams = streams;
  }

  async handle({
    body,
    scope,
    open,
    signal,
  }: {
    body: unknown;
    scope: string;
    open: (input: { signal: AbortSignal }) => Promise<SqliteExecutorContract>;
    signal: AbortSignal;
  }): Promise<HranaPipelineResponse> {
    const pipeline = parseHranaPipeline(body);
    const stream = await this.#streams.acquire({
      baton: pipeline.baton ?? null,
      scope,
      open,
      signal,
    });
    try {
      const results: StreamResult[] = [];
      for (const request of pipeline.requests) {
        signal.throwIfAborted();
        results.push(await this.#result({ request, stream, signal }));
        if (Buffer.byteLength(JSON.stringify(results)) > MAX_RESPONSE_BYTES) {
          throw new HranaError({
            message: 'SQLite results exceed the response limit',
            code: 'RESULT_TOO_LARGE',
          });
        }
      }
      signal.throwIfAborted();
      return { baton: this.#streams.release(stream), base_url: null, results };
    } catch (error) {
      await this.#streams.close(stream);
      throw error;
    }
  }

  async #result({
    request,
    stream,
    signal,
  }: {
    request: HranaStreamRequest;
    stream: HranaStream;
    signal: AbortSignal;
  }): Promise<StreamResult> {
    try {
      if (stream.closed) {
        throw new HranaError({ message: 'Stream is closed', code: 'STREAM_CLOSED' });
      }
      return { type: 'ok', response: await this.#request({ request, stream, signal }) };
    } catch (error) {
      signal.throwIfAborted();
      return { type: 'error', error: hranaError(error) };
    }
  }

  async #request({
    request,
    stream,
    signal,
  }: {
    request: HranaStreamRequest;
    stream: HranaStream;
    signal: AbortSignal;
  }): Promise<StreamResponse> {
    const { executor, storedSql } = stream;
    switch (request.type) {
      case 'execute':
        return {
          type: request.type,
          result: hranaStatementResult(
            await executor.execute({
              statement: hranaStatement({ statement: request.stmt, storedSql }),
              signal,
            }),
          ),
        };
      case 'batch':
        return {
          type: request.type,
          result: await executeHranaBatch({ batch: request.batch, executor, storedSql, signal }),
        };
      case 'describe':
        return {
          type: request.type,
          result: hranaDescribeResult(
            await executor.describe({
              sql: resolveHranaSql({ reference: request, storedSql }),
              signal,
            }),
          ),
        };
      case 'sequence':
        await executor.sequence({
          sql: resolveHranaSql({ reference: request, storedSql }),
          signal,
        });
        return { type: request.type };
      case 'store_sql':
        storeSql({ request, stream });
        return { type: request.type };
      case 'close_sql':
        storedSql.delete(request.sql_id);
        return { type: request.type };
      case 'close':
        await this.#streams.close(stream);
        return { type: request.type };
    }
  }
}

function storeSql({
  request,
  stream,
}: {
  request: Extract<HranaStreamRequest, { type: 'store_sql' }>;
  stream: HranaStream;
}): void {
  if (stream.storedSql.has(request.sql_id)) {
    throw new HranaError({ message: 'SQL text id is already in use', code: 'SQL_EXISTS' });
  }
  if (stream.storedSql.size >= MAX_STORED_SQL) {
    throw new HranaError({ message: 'Too many stored SQL texts', code: 'SQL_LIMIT' });
  }
  stream.storedSql.set(request.sql_id, request.sql);
}
