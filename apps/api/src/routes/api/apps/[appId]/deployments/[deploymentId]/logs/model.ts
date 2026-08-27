import { LogTimerangeSchema } from '@repo/protocol';
import { t } from 'elysia';

/**
 * How much history precedes the follow, defaulted at the handler like every other range this api
 * takes. There is nothing to resume from: a stream is followed rather than paged, so where it has
 * got to is its own to remember and never reaches the reader.
 *
 * `follow` is what a reader with nothing to wait for says: an app that is not running writes
 * nothing more, and a stream held open on one is a terminal that never comes back.
 */
export const StreamLogsQuerySchema = t.Object({
  timerange: t.Optional(LogTimerangeSchema),
  follow: t.Optional(t.Boolean()),
});
