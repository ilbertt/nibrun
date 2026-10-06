import type { TenantLogRecord } from '@repo/protocol';

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
