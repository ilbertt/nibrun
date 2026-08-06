import { describe, expect, test } from 'bun:test';
import {
  AppIdSchema,
  DeploymentIdSchema,
  HostIdSchema,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import type { QueryRequest } from '#lib/victorialogs/client.ts';
import type { LogRow } from '#lib/victorialogs/parse.ts';
import { LogsRepository, type TenantLogStore } from '#repositories/logs.repository.ts';

const APP_ID = Value.Parse(AppIdSchema, 'app-1');
const DEPLOYMENT_ID = Value.Parse(DeploymentIdSchema, 'deployment-1');
const HOST_ID = Value.Parse(HostIdSchema, 'host-1');
const SINCE = Value.Parse(TimestampSchema, '2026-08-06T09:41:00.123Z');
const LIMIT = 500;
const DROPPED_BYTES = 4096;

/**
 * A row as the store hands it over: every value a string, whatever the agent wrote. The client's
 * own tests cover getting this far; what matters here is what the repository makes of it.
 */
function storedRow(overrides: Record<string, string> = {}): LogRow {
  return {
    _time: '2026-08-06T09:41:00.123456789Z',
    _msg: 'listening on 0.0.0.0:8090',
    hostId: HOST_ID,
    SOURCE: 'tenant',
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    stream: 'stdout',
    sourceId: 'source-1',
    sequence: '0',
    ...overrides,
  };
}

function store(rows: LogRow[]): TenantLogStore & { asked: QueryRequest[] } {
  const asked: QueryRequest[] = [];
  return {
    asked,
    query: {
      run(request: QueryRequest) {
        asked.push(request);
        return Promise.resolve(rows);
      },
    },
  };
}

async function read(rows: LogRow[]) {
  const client = store(rows);
  const records = await new LogsRepository(client).read({
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    since: SINCE,
    limit: LIMIT,
  });
  return { records, asked: client.asked };
}

describe('a read takes one window of one deployment out of the store', () => {
  test('the filter names the stream fields before the deployment', async () => {
    const { asked } = await read([]);

    expect(asked[0]?.query).toStartWith(
      `SOURCE:="tenant" appId:="${APP_ID}" deploymentId:="${DEPLOYMENT_ID}"`,
    );
    expect(asked[0]?.start).toBe(SINCE);
  });

  // The store's own limit keeps the newest matches, which read forward from a cursor would skip
  // everything between the window's start and the last page of it.
  test('the window is cut at its far end, by sorting before the limit applies', async () => {
    const { asked } = await read([]);

    expect(asked[0]?.query).toEndWith(`| sort by (_time) limit ${LIMIT}`);
  });

  test('a stored row becomes a record the protocol accepts', async () => {
    const { records } = await read([storedRow()]);

    expect(records[0]?.sequence).toBe(0);
    expect(records[0]?.deploymentId).toBe(DEPLOYMENT_ID);
    expect(records[0]?._msg).toBe('listening on 0.0.0.0:8090');
  });

  test('a gap keeps the byte count it reports as a number', async () => {
    const { records } = await read([
      storedRow({ droppedBytes: String(DROPPED_BYTES), stream: 'stderr' }),
    ]);

    expect(records[0]?.droppedBytes).toBe(DROPPED_BYTES);
  });

  // The schema is what would catch a field renamed on the writing side, and the reader is
  // watching a live app rather than auditing the store — so it drops the row and carries on.
  test('a row the protocol does not recognise is skipped rather than failing the window', async () => {
    const { hostId: _hostId, ...missingAField } = storedRow();
    const { records } = await read([missingAField, storedRow()]);

    expect(records).toHaveLength(1);
  });
});
