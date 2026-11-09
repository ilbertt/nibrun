import type { HostReportedState as NibrunnerReport } from '#lib/nibrunner/reported.gen.ts';
import type { TenantLogEvent } from '#lib/nibrunner/tenant-log.gen.ts';
import { ARTIFACT_DIGEST } from '#tests/support/artifacts.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  FIRST_HOST_PORT,
  HOST_ID,
  OBSERVED_AT,
  VOLUME_ID,
  VOLUME_SIZE_BYTES,
} from '#tests/support/fixtures.ts';
import { gzippedTarball, type TarballEntry, TYPE_DIRECTORY } from '#tests/support/tarball.ts';

export function nibrunnerExportArchive(entries: readonly TarballEntry[]) {
  return gzippedTarball([{ path: 'data/app/data', type: TYPE_DIRECTORY }, ...entries]);
}

export function nibrunnerTenantLog(): Extract<TenantLogEvent, { kind: 'data' }> {
  return {
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    sourceId: 'nibrunner-source',
    sequence: 0,
    observedAt: OBSERVED_AT,
    kind: 'data',
    stream: 'stdout',
    text: 'tenant output',
  };
}

export function nibrunnerReport(overrides: Partial<NibrunnerReport> = {}): NibrunnerReport {
  return {
    hostId: HOST_ID,
    reportedAt: OBSERVED_AT,
    state: 'ready',
    capacity: { vcpuCount: 4, memoryMib: 8192, cacheBytes: 1000 },
    allocatable: { vcpuCount: 3, memoryMib: 7936, cacheBytes: 900 },
    versions: { agent: '2026.11.1', guestImage: 'guest', firecracker: 'v1.16.1', zerofs: 'none' },
    cron: null,
    volumes: [
      {
        volumeId: VOLUME_ID,
        appId: APP_ID,
        state: 'ready',
        sizeBytes: VOLUME_SIZE_BYTES,
        usage: null,
      },
    ],
    instances: [
      {
        appId: APP_ID,
        deploymentId: DEPLOYMENT_ID,
        state: 'running',
        compute: null,
        hostPort: FIRST_HOST_PORT,
        layerDigests: [ARTIFACT_DIGEST],
        restartCount: 0,
        startedAt: OBSERVED_AT,
        convergedAt: OBSERVED_AT,
      },
    ],
    checkpoints: [],
    exports: [],
    acceptedDigest: ARTIFACT_DIGEST,
    acceptedRevision: 'desired-1',
    message: null,
    ...overrides,
  };
}
