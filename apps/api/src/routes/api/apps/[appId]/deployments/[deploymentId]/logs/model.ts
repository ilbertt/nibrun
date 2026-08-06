import { LogTimerangeSchema } from '@repo/protocol';
import { t } from 'elysia';

/**
 * How much history precedes the follow, defaulted at the handler like every other range this api
 * takes. There is nothing to resume from: a stream is followed rather than paged, so where it has
 * got to is its own to remember and never reaches the reader.
 */
export const StreamLogsQuerySchema = t.Object({
  timerange: t.Optional(LogTimerangeSchema),
});
