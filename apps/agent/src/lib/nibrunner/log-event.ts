import { type AppId, type HostId, parseMessage, TenantLogRecordSchema } from '@repo/protocol';
import { Data, Effect } from 'effect';
import { type TenantLogEvent, tenantLogRecord } from '#lib/logs/event.ts';
import type { TenantLogEvent as NibrunnerTenantLogEvent } from '#lib/nibrunner/tenant-log.gen.ts';

export class InvalidNibrunnerLog extends Data.TaggedError('InvalidNibrunnerLog') {
  override get message() {
    return 'A nibrunner tenant log record could not be read.';
  }
}

function eventBody(value: NibrunnerTenantLogEvent) {
  switch (value.kind) {
    case 'data':
      return { kind: 'data' as const, stream: value.stream, text: value.text };
    case 'cron-data':
      return {
        kind: 'data' as const,
        stream: value.stream,
        text: value.text,
        cronJobId: value.jobId,
        cronRunId: value.runId,
      };
    case 'gap':
      return { kind: 'gap' as const, droppedBytes: value.droppedBytes };
    case 'restart':
      return { kind: 'data' as const, stream: 'stderr' as const, text: value.reason };
    default:
      throw new InvalidNibrunnerLog();
  }
}

export function nibrunnerLogEvent({
  value,
  appId,
  hostId,
}: {
  value: unknown;
  appId: AppId;
  hostId: HostId;
}) {
  return Effect.try({
    try: () => {
      const record = value as NibrunnerTenantLogEvent;
      if (record.appId !== appId) {
        throw new InvalidNibrunnerLog();
      }
      if (record.kind === 'gap' && record.droppedBytes === 0) {
        return undefined;
      }
      const event = {
        appId: record.appId,
        deploymentId: record.deploymentId,
        sourceId: record.sourceId,
        sequence: record.sequence,
        observedAt: record.observedAt,
        ...eventBody(record),
      } as TenantLogEvent;
      parseMessage({ schema: TenantLogRecordSchema, value: tenantLogRecord({ event, hostId }) });
      return event;
    },
    catch: () => new InvalidNibrunnerLog(),
  });
}
