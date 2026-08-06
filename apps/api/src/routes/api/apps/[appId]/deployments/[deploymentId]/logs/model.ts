import { t } from 'elysia';

/**
 * How much history precedes the follow. A LogsQL duration rather than a line count: the store's
 * tail cannot be limited by rows, so the only bound expressible here is one in time.
 */
const START_OFFSET_PATTERN = '^[1-9][0-9]{0,3}[smh]$';

export const DEFAULT_START_OFFSET = '5m';

export const TailLogsQuerySchema = t.Object({
  startOffset: t.Optional(
    t.String({
      pattern: START_OFFSET_PATTERN,
      default: DEFAULT_START_OFFSET,
      description: 'How far back the tail starts, as a LogsQL duration such as 5m.',
    }),
  ),
});
