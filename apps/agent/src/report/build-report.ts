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
import type { InstanceRecord } from '#report/instance-record.ts';

/**
 * Every optional field is omitted rather than sent empty. Absent means unknown or not
 * applicable, and there is one convention for that so nothing downstream has to decide what
 * the difference between absent and null would have meant.
 */
export function toReportedInstance(record: InstanceRecord): ReportedInstance {
  return {
    instanceId: record.instanceId,
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
  observedGeneration,
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
  observedGeneration: number;
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
    observedGeneration,
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
