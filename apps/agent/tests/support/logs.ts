import { MAX_BUFFERED_BYTES, type TenantLogQueue } from '#services/tenant-log-queue.service.ts';

/**
 * Everything the queue is holding, as one batch — the buffer's own cap is the bound, so nothing
 * it accepted can be left behind by the batch limit.
 */
export function drainedEvents(queue: TenantLogQueue) {
  return queue.take({ maxBytes: MAX_BUFFERED_BYTES });
}
