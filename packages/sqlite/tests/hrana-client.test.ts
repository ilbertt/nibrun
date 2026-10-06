import { describe, expect, test } from 'bun:test';
import { createClient } from '@libsql/client/http';
import { HranaPipelineAdapter } from '#hrana-pipeline.ts';
import { HranaStreams } from '#hrana-streams.ts';
import { LocalSqliteExecutor } from '#tests/support/sqlite.ts';

function fixture() {
  const streams = new HranaStreams({ limit: undefined, idleTimeoutMs: undefined });
  const adapter = new HranaPipelineAdapter(streams);
  const paths: string[] = [];
  let opened = 0;
  function open() {
    opened += 1;
    return Promise.resolve(new LocalSqliteExecutor());
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === '/selection/v2' && request.method === 'GET') {
        return new Response();
      }
      if (path !== '/selection/v2/pipeline' || request.method !== 'POST') {
        return new Response(null, { status: 404 });
      }
      try {
        return Response.json(
          await adapter.handle({
            body: await request.json(),
            scope: 'owner/selection',
            open,
            signal: request.signal,
          }),
        );
      } catch (error) {
        return new Response(error instanceof Error ? error.message : String(error), {
          status: 400,
          headers: { 'content-type': 'text/plain' },
        });
      }
    },
  });
  const client = createClient({
    url: `http://127.0.0.1:${server.port}/selection/`,
    intMode: 'bigint',
  });
  async function close() {
    client.close();
    await streams.closeAll();
    await server.stop(true);
  }
  function openedCount() {
    return opened;
  }
  return { client, close, paths, openedCount };
}

describe('official libSQL HTTP client compatibility', () => {
  test('negotiates v2 beneath a selected-file URL and preserves positional value types', async () => {
    const connection = fixture();
    try {
      const LARGE_INTEGER = 9_223_372_036_854_775_807n;
      const FLOAT_VALUE = 1.5;
      const BLOB_BYTES = new Uint8Array([0, 1]);
      const result = await connection.client.execute({
        sql: 'SELECT ? AS large, ? AS text, ? AS bytes, ? AS null_value, ? AS decimal',
        args: [LARGE_INTEGER, 'hello', BLOB_BYTES, null, FLOAT_VALUE],
      });
      expect(result.rows[0]?.large).toBe(LARGE_INTEGER);
      expect(result.rows[0]?.text).toBe('hello');
      expect(result.rows[0]?.null_value).toBeNull();
      expect(result.rows[0]?.decimal).toBe(FLOAT_VALUE);
      expect(new Uint8Array(result.rows[0]?.bytes as ArrayBuffer)).toEqual(BLOB_BYTES);
      expect(connection.paths).toContain('/selection/v2/pipeline');
    } finally {
      await connection.close();
    }
  });

  test('supports named parameters and SDK conditional batches', async () => {
    const connection = fixture();
    try {
      const result = await connection.client.execute({
        sql: 'SELECT name FROM items WHERE id = :id',
        args: { id: 1 },
      });
      expect(result.rows[0]?.name).toBe('first');
      const batch = await connection.client.batch(
        ['SELECT count(*) AS count FROM items', 'SELECT count(*) AS count FROM items'],
        'deferred',
      );
      expect(
        batch.map(function count(result) {
          return result.rows[0]?.count;
        }),
      ).toEqual([2n, 2n]);
    } finally {
      await connection.close();
    }
  });

  test('retains one SQLite connection across interactive transaction requests', async () => {
    const connection = fixture();
    try {
      const transaction = await connection.client.transaction('read');
      const first = await transaction.execute('SELECT name FROM items WHERE id = 1');
      const second = await transaction.execute('SELECT name FROM items WHERE id = 2');
      expect(first.rows[0]?.name).toBe('first');
      expect(second.rows[0]?.name).toBe('second');
      await transaction.commit();
      expect(connection.openedCount()).toBe(1);
    } finally {
      await connection.close();
    }
  });

  test('propagates SQL errors and supports sequences', async () => {
    const connection = fixture();
    try {
      await expect(connection.client.execute('SELECT missing FROM items')).rejects.toThrow(
        'missing',
      );
      await connection.client.executeMultiple('SELECT 1; SELECT 2;');
    } finally {
      await connection.close();
    }
  });
});
