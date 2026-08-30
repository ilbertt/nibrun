import { addressedDeployment, followLogs } from '@repo/app-operations';
import type { TenantLogRecord } from '@repo/protocol';
import { z } from 'zod';
import { AppSlugSchema, answered, type ToolRegistration } from '#tool.ts';

/**
 * What one call hands back. A tail is what a reader wants and a whole log is what an app has, and
 * the difference between them is a context window — so this is capped and says when it capped.
 */
const MAX_RECORDS = 500;

/** A backstop on a window that turns out to hold far more than it sounded like. */
const READ_TIMEOUT_MS = 30_000;

export function registerLogTools({ server, api }: ToolRegistration): void {
  server.registerTool(
    'read_logs',
    {
      title: 'Read app output',
      description: `What the app has written over a window ending now, newest ${MAX_RECORDS} lines at most. Reads to the end of what the api has and returns — it never waits on output the app has not written yet.`,
      inputSchema: z.object({
        app: AppSlugSchema,
        timerange: z
          .string()
          .default('1h')
          .describe('How far back to read, as a duration the api takes: `15m`, `1h`, `7d`.'),
      }),
      outputSchema: z.object({
        records: z.array(
          z.object({
            time: z.string(),
            stream: z.string(),
            message: z.string(),
            droppedBytes: z.number().optional(),
          }),
        ),
        truncated: z.boolean(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ app: slug, timerange }) =>
      answered({
        produce: async () => {
          const { appId, deploymentId } = await addressedDeployment({
            api,
            slug,
            deploymentId: undefined,
            operation: 'logs',
          });
          const signal = AbortSignal.timeout(READ_TIMEOUT_MS);
          const { records, dropped } = await lastRecords({
            stream: followLogs({
              api,
              appId,
              deploymentId,
              timerange,
              following: false,
              signal,
            }),
          });
          return {
            records: records.map(readable),
            // A read the backstop cut short is a truncated one too, and one nothing here would
            // otherwise notice: the stream ends quietly when its signal fires.
            truncated: dropped || signal.aborted,
          };
        },
      }),
  );
}

/**
 * The newest records, by reading all of them and keeping the last few.
 *
 * The stream is oldest first, so stopping at the cap would keep the beginning of the window and
 * throw away the end — and the end is what a reader asking about a failure came for. Reading on
 * costs the window's own length; holding it would cost the app's, which is why what is held is
 * only ever the cap.
 */
async function lastRecords({
  stream,
}: {
  stream: AsyncGenerator<TenantLogRecord>;
}): Promise<{ records: TenantLogRecord[]; dropped: boolean }> {
  const records: TenantLogRecord[] = [];
  let dropped = false;
  for await (const record of stream) {
    records.push(record);
    if (records.length > MAX_RECORDS) {
      records.shift();
      dropped = true;
    }
  }
  return { records, dropped };
}

function readable(record: TenantLogRecord) {
  return {
    time: record._time,
    stream: record.stream,
    message: record._msg,
    ...(record.droppedBytes !== undefined && { droppedBytes: record.droppedBytes }),
  };
}
