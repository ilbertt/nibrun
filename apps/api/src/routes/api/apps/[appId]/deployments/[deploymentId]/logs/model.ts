import { LogTimerangeSchema, TenantLogRecordSchema, TimestampSchema } from '@repo/protocol';
import { t } from 'elysia';

/**
 * Where to resume, or how far back to start when there is nothing to resume from — defaulted at
 * the handler, like every other range this api takes. Naming both is allowed and `since` wins: a
 * reader following an app sends back the cursor it was last given and has no reason to keep
 * restating the range its first read used.
 */
export const PollLogsQuerySchema = t.Object({
  since: t.Optional(TimestampSchema),
  timerange: t.Optional(LogTimerangeSchema),
});

/**
 * `cursor` is what the next read passes back as `since`, and it is returned whether or not
 * anything was found — a reader that got nothing still has to know where its wait got to.
 */
export const TenantLogPageSchema = t.Object({
  records: t.Array(TenantLogRecordSchema),
  cursor: TimestampSchema,
});
