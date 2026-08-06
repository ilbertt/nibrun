import { afterAll, describe, expect, test } from 'bun:test';
import { VictoriaLogsClient, VictoriaLogsError } from '#lib/victorialogs/client.ts';
import type { LogRow } from '#lib/victorialogs/parse.ts';

const QUERY = 'SOURCE:="tenant"';
const START_OFFSET = '5m';
const TAIL_TIMEOUT_MS = 5_000;
const HALF = 2;
const BAD_REQUEST = 400;

const jsonLine = (fields: Record<string, string>) => `${JSON.stringify(fields)}\n`;

type Answer = { status?: number; body: string; chunkAt?: number };
type Asked = { path: string; form: URLSearchParams };

const asked: Asked[] = [];
let answer: Answer = { body: '' };

// A real socket rather than a stubbed fetch: what is under test is reading a response the store
// holds open, and a stub handing back one whole string never splits a record across two reads.
const store = Bun.serve({
  port: 0,
  async fetch(request) {
    asked.push({
      path: new URL(request.url).pathname,
      form: new URLSearchParams(await request.text()),
    });
    const { status = 200, body, chunkAt } = answer;
    if (chunkAt === undefined) {
      return new Response(body, { status });
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(body);
        controller.enqueue(bytes.slice(0, chunkAt));
        controller.enqueue(bytes.slice(chunkAt));
        controller.close();
      },
    });
    return new Response(stream, { status });
  },
});

afterAll(() => store.stop(true));

const client = new VictoriaLogsClient(new URL(store.url.toString()));

async function collect(): Promise<LogRow[]> {
  asked.length = 0;
  const rows: LogRow[] = [];
  for await (const row of client.tail.subscribe({
    query: QUERY,
    startOffset: START_OFFSET,
    signal: AbortSignal.timeout(TAIL_TIMEOUT_MS),
  })) {
    rows.push(row);
  }
  return rows;
}

describe('the tail endpoint follows a query the store holds open', () => {
  test('it asks its own path, with the query in the body', async () => {
    answer = { body: '' };
    await collect();

    expect(asked[0]?.path).toBe('/select/logsql/tail');
    expect(asked[0]?.form.get('query')).toBe(QUERY);
    expect(asked[0]?.form.get('start_offset')).toBe(START_OFFSET);
  });

  test('each line is a row', async () => {
    answer = { body: `${jsonLine({ _msg: 'first' })}${jsonLine({ _msg: 'second' })}` };

    expect((await collect()).map((row) => row._msg)).toEqual(['first', 'second']);
  });

  // The store writes as records arrive, so a record straddling two reads is ordinary.
  test('a record split across two reads is still one row', async () => {
    const body = jsonLine({ _msg: 'listening on 0.0.0.0:8090' });
    answer = { body, chunkAt: Math.floor(body.length / HALF) };

    expect(await collect()).toHaveLength(1);
  });

  // Ending the stream would take the whole log view down with it, and the reader is watching a
  // live app rather than auditing the store.
  test('a line that is not a JSON object is skipped rather than ending the tail', async () => {
    answer = { body: `not json\n${jsonLine({ _msg: 'kept' })}[1,2]\n` };

    expect((await collect()).map((row) => row._msg)).toEqual(['kept']);
  });

  test('a store that refuses the query says so rather than reading empty', () => {
    answer = { status: BAD_REQUEST, body: 'unexpected token' };

    expect(collect()).rejects.toThrow(VictoriaLogsError);
  });
});
