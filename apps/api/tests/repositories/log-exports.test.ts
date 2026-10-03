import { describe, expect, test } from 'bun:test';
import { AppIdSchema, TimestampSchema, Value } from '@repo/protocol';
import type { VictoriaLogsExport } from '#lib/victorialogs/client.ts';
import { LogExportsRepository } from '#repositories/log-exports.repository.ts';

const APP_ID = Value.Parse(AppIdSchema, 'app-1');
const THROUGH = Value.Parse(TimestampSchema, '2026-10-03T15:00:00Z');

function row(overrides: Record<string, string> = {}) {
  return {
    _time: '2026-10-01T09:00:00Z',
    _msg: 'hello',
    SOURCE: 'tenant',
    appId: APP_ID,
    deploymentId: 'deployment-1',
    hostId: 'host-1',
    stream: 'stdout',
    sourceId: 'source-1',
    sequence: '0',
    ...overrides,
  };
}

async function read(rows: unknown[]) {
  const requests: Parameters<VictoriaLogsExport['open']>[0][] = [];
  const body = new TextEncoder().encode(rows.map((value) => JSON.stringify(value)).join('\n'));
  const repository = new LogExportsRepository({
    open(input) {
      requests.push(input);
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const byte of body) {
              controller.enqueue(new Uint8Array([byte]));
            }
            controller.close();
          },
        }),
      );
    },
  });
  const signal = new AbortController().signal;
  const records = await Array.fromAsync(
    await repository.open({ appId: APP_ID, through: THROUGH, signal }),
  );
  return { requests, records, signal };
}

describe('exporting all retained app logs', () => {
  test('uses an app filter with a fixed end and no deployment or row limit', async () => {
    const { requests, signal } = await read([]);
    expect(requests).toEqual([{ query: 'SOURCE:="tenant" appId:="app-1"', end: THROUGH, signal }]);
  });

  test('keeps output across deployments, cron context, gaps, and fragmented Unicode', async () => {
    const { records } = await read([
      row({ _msg: '秘密\nhello' }),
      row({
        deploymentId: 'deployment-2',
        stream: 'stderr',
        sequence: '1',
        droppedBytes: '123',
        cronJobId: 'job-1',
        cronRunId: 'run-1',
      }),
    ]);
    expect(records).toHaveLength(2);
    expect(records[0]?._msg).toBe('秘密\nhello');
    expect(records[1]).toMatchObject({
      deploymentId: 'deployment-2',
      stream: 'stderr',
      sequence: 1,
      droppedBytes: 123,
      cronJobId: 'job-1',
      cronRunId: 'run-1',
    });
  });

  test.each([row({ appId: 'another-app' }), { _msg: 'incomplete' }])(
    'refuses an invalid or cross-app record',
    async (invalid) => {
      await expect(read([row(), invalid])).rejects.toThrow('invalid app log record');
    },
  );
});
