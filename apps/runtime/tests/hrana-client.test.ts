import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createClient } from '@libsql/client/http';

const TEST_IMAGE = 'nibrun-runtime-hrana-test';
const LARGE_INTEGER = 9_223_372_036_854_775_807n;
const FLOAT_VALUE = 1.5;
const MAX_BYTE = 255;
const BLOB_BYTES = new Uint8Array([0, 1, MAX_BYTE]);
const READINESS_ATTEMPTS = 50;
const READINESS_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 30_000;
const SEQUENCE_RESULT = 3n;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
let container: string | undefined;
let origin = '';

async function docker(args: string[]): Promise<string> {
  const process = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(`Docker failed: ${stderr}`);
  }
  return stdout.trim();
}

function connection(path: string) {
  return createClient({ url: `${origin}/sqlite/${encodeURIComponent(path)}/`, intMode: 'bigint' });
}

beforeAll(async function startGuestServer() {
  container = await docker([
    'run',
    '--detach',
    '--rm',
    '--platform',
    process.env.RUNTIME_TEST_PLATFORM ?? 'linux/amd64',
    '--publish',
    '127.0.0.1::8080',
    TEST_IMAGE,
  ]);
  const address = await docker(['port', container, '8080/tcp']);
  origin = `http://${address}`;
  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${origin}/sqlite/%2Fapp.db/v2`, {
        headers: { connection: 'close' },
      });
      await response.arrayBuffer();
      if (response.ok) {
        return;
      }
    } catch {}
    await Bun.sleep(READINESS_INTERVAL_MS);
  }
  throw new Error('The native Hrana server did not become ready.');
}, STARTUP_TIMEOUT_MS);

afterAll(async function stopGuestServer() {
  if (container !== undefined) {
    await docker(['rm', '--force', container]);
  }
});

describe('native guest with the official libSQL HTTP client', () => {
  test('negotiates Hrana v2 and preserves all SQLite value types', async () => {
    const client = connection('/app.db');
    try {
      const result = await client.execute({
        sql: 'SELECT ? AS large, ? AS text, ? AS bytes, ? AS null_value, ? AS decimal',
        args: [LARGE_INTEGER, 'héllo\0world', BLOB_BYTES, null, FLOAT_VALUE],
      });
      expect(result.rows[0]?.large).toBe(LARGE_INTEGER);
      expect(result.rows[0]?.text).toBe('héllo\0world');
      expect(result.rows[0]?.null_value).toBeNull();
      expect(result.rows[0]?.decimal).toBe(FLOAT_VALUE);
      expect(new Uint8Array(result.rows[0]?.bytes as ArrayBuffer)).toEqual(BLOB_BYTES);
    } finally {
      client.close();
    }
  });

  test('supports named parameters and SDK conditional batches', async () => {
    const client = connection('/app.db');
    try {
      const result = await client.execute({
        sql: 'SELECT :value AS value',
        args: { value: 'named' },
      });
      expect(result.rows[0]?.value).toBe('named');
      const batch = await client.batch(['SELECT 1 AS value', 'SELECT 2 AS value'], 'deferred');
      expect(
        batch.map(function value(result) {
          return result.rows[0]?.value;
        }),
      ).toEqual([1n, 2n]);
    } finally {
      client.close();
    }
  });

  test('retains a database stream across an interactive read transaction', async () => {
    const client = connection('/app.db');
    try {
      const transaction = await client.transaction('read');
      expect((await transaction.execute('SELECT 1 AS value')).rows[0]?.value).toBe(1n);
      expect((await transaction.execute('SELECT 2 AS value')).rows[0]?.value).toBe(2n);
      await transaction.commit();
    } finally {
      client.close();
    }
  });

  test('propagates SQL errors and supports sequences', async () => {
    const client = connection('/app.db');
    try {
      await expect(client.execute('SELECT missing_column')).rejects.toThrow('missing_column');
      await client.executeMultiple('SELECT 1; SELECT 2;');
      expect((await client.execute(`SELECT ${SEQUENCE_RESULT} AS value`)).rows[0]?.value).toBe(
        SEQUENCE_RESULT,
      );
    } finally {
      client.close();
    }
  });

  test('selects another database through its URL', async () => {
    const client = connection('/other.db');
    try {
      const result = await client.execute('PRAGMA database_list');
      expect(result.rows[0]?.file).toBe('/other.db');
    } finally {
      client.close();
    }
  });

  test('handles stored SQL, descriptions and conditional batch failures in one pipeline', async () => {
    const response = await fetch(`${origin}/sqlite/%2Fapp.db/v2/pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: [
          { type: 'store_sql', sql_id: 1, sql: 'SELECT :value AS value' },
          { type: 'describe', sql_id: 1 },
          {
            type: 'execute',
            stmt: {
              sql_id: 1,
              named_args: [{ name: 'value', value: { type: 'integer', value: '42' } }],
            },
          },
          {
            type: 'batch',
            batch: {
              steps: [
                { stmt: { sql: 'SELECT missing_column' } },
                { condition: { type: 'error', step: 0 }, stmt: { sql: 'SELECT 2 AS value' } },
                { condition: { type: 'ok', step: 0 }, stmt: { sql: 'SELECT 3 AS value' } },
              ],
            },
          },
          { type: 'close_sql', sql_id: 1 },
          { type: 'close' },
        ],
      }),
    });
    expect(response.status).toBe(HTTP_OK);
    const body = await response.json();
    expect(body.baton).toBeNull();
    expect(body.base_url).toBeNull();
    expect(body.results[1].response.result.params).toEqual([{ name: ':value' }]);
    expect(body.results[2].response.result.rows).toEqual([[{ type: 'integer', value: '42' }]]);
    const batch = body.results[3].response.result;
    expect(batch.step_errors[0].code).toBe('SQLITE_ERROR');
    expect(batch.step_results[1].rows).toEqual([[{ type: 'integer', value: '2' }]]);
    expect(batch.step_results[2]).toBeNull();
  });

  test('refuses writes, attached databases, and unsafe pragmas', async () => {
    const client = connection('/app.db');
    try {
      await expect(client.execute('CREATE TABLE forbidden(value)')).rejects.toThrow();
      await expect(client.execute("ATTACH '/other.db' AS other")).rejects.toThrow();
      await expect(client.execute('PRAGMA writable_schema=ON')).rejects.toThrow();
    } finally {
      client.close();
    }
  });

  test('rejects traversal before resolving the selected file', async () => {
    const response = await fetch(`${origin}/sqlite/%2F..%2Fapp.db/v2`, {
      headers: { connection: 'close' },
    });
    expect(response.status).toBe(HTTP_BAD_REQUEST);
    expect((await response.json()).code).toBe('SQLITE_CANTOPEN');
  });

  test.each(['/missing.db', '/link.db'])(
    'refuses unsafe file selection %s',
    async function refuses(path) {
      const client = connection(path);
      try {
        await expect(client.execute('SELECT 1')).rejects.toThrow();
      } finally {
        client.close();
      }
    },
  );
});
