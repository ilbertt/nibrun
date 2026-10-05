import { stringEnum, type TenantLogRecord } from '@repo/protocol';
import { Type } from '@sinclair/typebox';

/**
 * Which component wrote a record, and the one field that answers it for the whole fleet.
 *
 * Uppercase, alone among our fields, because it is the only one two very different writers have
 * to agree on. The agent stamps it on tenant output; every other component on an app host reaches
 * the store through its journal, where systemd requires field names to be uppercase — so a
 * lowercase name here would mean `source:tenant` and `SOURCE:agent` were the same question asked
 * two ways, and a query would have to know which half of the fleet it was addressing first.
 */
export const LOG_SOURCES = ['tenant', 'agent', 'firecracker', 'zerofs', 'caddy'] as const;
export const LogSourceSchema = stringEnum(LOG_SOURCES);
export type LogSource = (typeof LOG_SOURCES)[number];

/**
 * What a reader has already been handed, so a record read twice is handed over once.
 *
 * Following re-reads on both sides: the api resumes a window on the instant the last one ended
 * rather than after it, and a reader whose stream closes asks again for the seconds it was away.
 * Both ask the same question of a record, so the answer lives here beside the fields it reads.
 *
 * `sourceId` and `sequence` are what tell a second copy from a second record — but sequence is not
 * the order records arrive in. The store sorts on `_time`, a source writes many records within one
 * millisecond, and their order within it is the store's own. So a high-water mark per source drops
 * the rest of every instant whose newest record it happened to see first. What is kept instead is
 * the newest instant handed over and the keys seen at it: older is a repeat, newer is not, and only
 * a tie has to be looked up.
 *
 * Instants are compared to the millisecond, which is coarser than the store writes them. That can
 * only put two records in one bucket that belong in two, which costs a key and decides nothing.
 *
 * Records must arrive oldest first. That is what bounds this to one instant's keys rather than the
 * whole stream's, and what makes anything older than the newest a repeat rather than a late record.
 */
export class SeenTenantLogs {
  #newest = Number.NEGATIVE_INFINITY;
  readonly #keysAtNewest = new Set<string>();

  admit(record: TenantLogRecord): boolean {
    const at = Date.parse(record._time);
    if (at < this.#newest) {
      return false;
    }
    if (at > this.#newest) {
      this.#newest = at;
      this.#keysAtNewest.clear();
    }
    const key = `${record.sourceId}/${record.sequence}`;
    if (this.#keysAtNewest.has(key)) {
      return false;
    }
    this.#keysAtNewest.add(key);
    return true;
  }
}

/**
 * How much history a reader asks for before it starts following, as a duration such as `30s`.
 *
 * A duration rather than a number of lines, because the store is asked for a window of time and a
 * bound in rows is not one it could hold to. The pattern is exported beside the schema: a reader
 * whose validator is not TypeBox still has to refuse the same values this one does.
 */
export const LOG_TIMERANGE_PATTERN = '^[1-9][0-9]{0,3}[smh]$';
const MAX_LOG_TIMERANGE_LENGTH = 5;

export const LogTimerangeSchema = Type.String({
  description: 'How far back a log read starts, as a duration such as 30s, 5m or 2h.',
  pattern: LOG_TIMERANGE_PATTERN,
  maxLength: MAX_LOG_TIMERANGE_LENGTH,
});

export type LogTimerange = typeof LogTimerangeSchema.static;
export const DEFAULT_LOG_TIMERANGE = '5m';
