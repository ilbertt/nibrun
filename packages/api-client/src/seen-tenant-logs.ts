import type { TenantLogRecord } from '#models.ts';

// Streams replay an overlap after reconnecting. Sequence numbers can arrive out of order
// within a millisecond, so retain every key at the newest instant instead of a high-water mark.
// API streams are oldest-first, which bounds memory to one instant while discarding replayed history.
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
