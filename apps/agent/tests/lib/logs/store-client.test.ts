import { describe, expect, test } from 'bun:test';
import { CronJobIdSchema, CronRunIdSchema, TenantLogRecordSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import type { TenantLogEvent } from '#lib/logs/event.ts';
import { LOG_STREAM_FIELDS, makeLogStoreClient } from '#lib/logs/store-client.ts';
import { HOST_ID, tenantLogEvent } from '#tests/support/fixtures.ts';
import { runScoped } from '#tests/support/run.ts';
import { recordingServer } from '#tests/support/server.ts';

const CRON_JOB_ID = Value.Parse(CronJobIdSchema, 'cron-job-1');
const CRON_RUN_ID = Value.Parse(CronRunIdSchema, 'cron-run-1');
const DROPPED_BYTES = 1024;

function cronOutput(sequence: number): TenantLogEvent {
  return { ...tenantLogEvent(sequence), cronJobId: CRON_JOB_ID, cronRunId: CRON_RUN_ID };
}

function upload(events: readonly TenantLogEvent[]) {
  return runScoped(
    Effect.gen(function* () {
      const server = yield* recordingServer({});
      const client = makeLogStoreClient({ baseUrl: server.baseUrl });
      yield* client.publish({ hostId: HOST_ID, events });
      return server.received;
    }),
  );
}

describe('cron context in tenant log uploads', () => {
  test('stdout and buffering gaps retain their job and run IDs', async () => {
    const event = cronOutput(1);
    const gap: TenantLogEvent = {
      ...cronOutput(2),
      kind: 'gap',
      droppedBytes: DROPPED_BYTES,
    };
    const requests = await upload([event, gap]);
    const records = requests[0]?.body
      .trim()
      .split('\n')
      .map((line) => Value.Parse(TenantLogRecordSchema, JSON.parse(line)));

    expect(records).toHaveLength(2);
    for (const record of records ?? []) {
      expect(record.cronJobId).toBe(CRON_JOB_ID);
      expect(record.cronRunId).toBe(CRON_RUN_ID);
      expect(record.sourceId).toBe(event.sourceId);
    }
    expect(records?.[0]?.sequence).toBe(1);
    expect(records?.[1]?.sequence).toBe(2);
    expect(records?.[1]?.droppedBytes).toBe(DROPPED_BYTES);
  });

  test('run IDs do not create new VictoriaLogs streams', async () => {
    const requests = await upload([cronOutput(0)]);
    const url = new URL(requests[0]?.url ?? '');
    expect(url.searchParams.get('_stream_fields')).toBe(LOG_STREAM_FIELDS.join(','));
    expect(LOG_STREAM_FIELDS).not.toContain('cronJobId');
    expect(LOG_STREAM_FIELDS).not.toContain('cronRunId');
  });

  test('ordinary output has no cron context', async () => {
    const requests = await upload([tenantLogEvent()]);
    const record = Value.Parse(TenantLogRecordSchema, JSON.parse(requests[0]?.body ?? ''));
    expect(record.cronJobId).toBeUndefined();
    expect(record.cronRunId).toBeUndefined();
  });

  test('repeated uploads of a run retain their deduplication identity', async () => {
    const requests = await runScoped(
      Effect.gen(function* () {
        const server = yield* recordingServer({});
        const client = makeLogStoreClient({ baseUrl: server.baseUrl });
        const events = [cronOutput(0), cronOutput(1)];
        yield* client.publish({ events, hostId: HOST_ID });
        yield* client.publish({ events, hostId: HOST_ID });
        return server.received;
      }),
    );
    const uploads = requests.map((request) =>
      request.body
        .trim()
        .split('\n')
        .map((line) => Value.Parse(TenantLogRecordSchema, JSON.parse(line))),
    );
    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toHaveLength(2);
    expect(uploads[0]).toEqual(uploads[1]);
    expect(uploads[0]?.map((record) => record.cronRunId)).toEqual([CRON_RUN_ID, CRON_RUN_ID]);
  });
});
