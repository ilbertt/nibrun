import type {
  HostCapacity,
  HostId,
  HostReportedState,
  HostState,
  HostVersions,
  ReportedCheckpoint,
  ReportedExport,
  ReportedInstance,
  ReportedVolume,
  Timestamp,
} from '@repo/protocol';
import type { InstanceRecord } from '#lib/report/instance-record.ts';

/** Optional fields are omitted rather than sent empty: absent is the one convention for unknown. */
export function toReportedInstance(record: InstanceRecord): ReportedInstance {
  return {
    appId: record.appId,
    deploymentId: record.deploymentId,
    state: record.state,
    hostPort: record.hostPort,
    guestIpv4: record.guestIpv4,
    artifactDigest: record.artifactDigest,
    restartCount: record.restartCount,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.health.lastHealthyAt ? { lastHealthyAt: record.health.lastHealthyAt } : {}),
    ...(record.lastExitCode === undefined ? {} : { lastExitCode: record.lastExitCode }),
    ...(record.message ? { message: record.message } : {}),
  };
}

export function buildReportedState({
  hostId,
  reportedAt,
  state,
  capacity,
  allocatable,
  versions,
  records,
  volumes,
  checkpoints,
  exports,
}: {
  hostId: HostId;
  reportedAt: Timestamp;
  state: HostState;
  capacity: HostCapacity;
  allocatable: HostCapacity;
  versions: HostVersions;
  records: readonly InstanceRecord[];
  volumes: readonly ReportedVolume[];
  checkpoints: readonly ReportedCheckpoint[];
  exports: readonly ReportedExport[];
}): HostReportedState {
  return {
    hostId,
    reportedAt,
    state,
    capacity,
    allocatable,
    versions,
    volumes: [...volumes],
    instances: records.map(toReportedInstance),
    checkpoints: [...checkpoints],
    exports: [...exports],
  };
}
