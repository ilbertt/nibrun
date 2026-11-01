import type { HostReportedState as NibrunnerReport } from '#lib/nibrunner/reported.gen.ts';
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

export function nibrunnerReport(overrides: Partial<NibrunnerReport> = {}): NibrunnerReport {
  return {
    hostId: HOST_ID,
    reportedAt: OBSERVED_AT,
    state: 'ready',
    capacity: { vcpuCount: 4, memoryMib: 8192, cacheBytes: 1000 },
    allocatable: { vcpuCount: 3, memoryMib: 7936, cacheBytes: 900 },
    versions: { agent: '2026.10.7', guestImage: 'guest', firecracker: 'v1.16.1', zerofs: 'none' },
    volumes: [{ volumeId: VOLUME_ID, appId: APP_ID, state: 'ready', sizeBytes: VOLUME_SIZE_BYTES }],
    instances: [
      {
        appId: APP_ID,
        deploymentId: DEPLOYMENT_ID,
        state: 'running',
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
