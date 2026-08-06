import type { HostId, TenantLogRecord, TenantLogStream, Timestamp } from '@repo/protocol';
import type { TenantLogSource } from '#lib/logs/vsock.ts';

/**
 * What the receiver hands the buffer, before a host id exists to stamp it with.
 *
 * The agent learns its host id from the session, which it may not hold yet when a guest starts
 * writing. Keeping that field off until the record is built is what lets output survive the gap
 * rather than being dropped for want of a label — and it is why this shape is the agent's own
 * rather than the record the store keeps.
 */
export type TenantLogEvent = TenantLogSource & {
  readonly sourceId: string;
  readonly sequence: number;
  readonly observedAt: Timestamp;
} & (
    | { readonly kind: 'data'; readonly stream: TenantLogStream; readonly text: string }
    | { readonly kind: 'gap'; readonly droppedBytes: number }
  );

/**
 * A gap is a record rather than a counter, so it lands in the same ordered stream as the output
 * it replaces: reading the log is how you find out something is missing, and from where.
 */
const GAP_MESSAGE = 'tenant output dropped by host buffering';

export function tenantLogRecord({
  event,
  hostId,
}: {
  event: TenantLogEvent;
  hostId: HostId;
}): TenantLogRecord {
  const common = {
    _time: event.observedAt,
    hostId,
    SOURCE: 'tenant',
    appId: event.appId,
    deploymentId: event.deploymentId,
    sourceId: event.sourceId,
    sequence: event.sequence,
  } as const;
  return event.kind === 'gap'
    ? { ...common, _msg: GAP_MESSAGE, stream: 'stderr', droppedBytes: event.droppedBytes }
    : { ...common, _msg: event.text, stream: event.stream };
}
