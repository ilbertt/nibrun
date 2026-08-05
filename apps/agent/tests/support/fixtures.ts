import {
  type AppId,
  type CheckpointId,
  DEFAULT_GUEST_PORT,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
  type DeploymentId,
  type DesiredArtifact,
  type DesiredCheckpoint,
  type DesiredExport,
  type DesiredInstance,
  type DesiredVolume,
  type ExportId,
  type Filename,
  type HostDesiredState,
  type HostId,
  type HostPort,
  type InstanceId,
  type ObjectKey,
  type Timestamp,
  type VolumeId,
} from '@repo/protocol';
import type { TenantLogEvent } from '#lib/logs/event.ts';
import { HOST_PORT_BASE } from '#lib/network/slot.ts';
import type { ObservedInstance, ObservedState, ObservedVolume } from '#lib/reconcile/plan.ts';
import { ARTIFACT_BYTES, ARTIFACT_DIGEST } from '#tests/support/artifacts.ts';
import { HOST_STORAGE_PREFIX } from '#tests/support/config.ts';

export const APP_ID = 'app-1' as AppId;
export const VOLUME_ID = 'vol-1' as VolumeId;
export const INSTANCE_ID = 'inst-1' as InstanceId;
export const DEPLOYMENT_ID = 'dep-1' as DeploymentId;
export const HOST_ID = 'host-1' as HostId;
export const CHECKPOINT_ID = 'chk-1' as CheckpointId;
export const EXPORT_ID = 'exp-1' as ExportId;
export const OBSERVED_AT = '2026-08-03T10:00:00.000Z' as Timestamp;

export const VOLUME_SIZE_BYTES = 4_096;
export const FIRST_HOST_PORT = HOST_PORT_BASE as HostPort;

export function artifact(overrides: Partial<DesiredArtifact> = {}): DesiredArtifact {
  return {
    digest: ARTIFACT_DIGEST,
    sizeBytes: ARTIFACT_BYTES.byteLength,
    // A uuid, as the api will assign: it carries no name, which is why `filename` exists.
    objectKey: 'artifacts/9f1c2f0e-0d4e-4a1b-9c3a-1f8b6d2e7a45' as ObjectKey,
    filename: 'pocketbase' as Filename,
    ...overrides,
  };
}

export function desiredInstance(overrides: Partial<DesiredInstance> = {}): DesiredInstance {
  return {
    instanceId: INSTANCE_ID,
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    volumeId: VOLUME_ID,
    desiredState: 'running',
    artifact: artifact(),
    config: {
      guestPort: DEFAULT_GUEST_PORT,
      args: [],
      environment: {},
      resources: DEFAULT_INSTANCE_RESOURCES,
      healthCheck: DEFAULT_HEALTH_CHECK,
      restartPolicy: DEFAULT_RESTART_POLICY,
    },
    hostnames: [],
    ...overrides,
  };
}

export function desiredVolume(overrides: Partial<DesiredVolume> = {}): DesiredVolume {
  return {
    volumeId: VOLUME_ID,
    appId: APP_ID,
    sizeBytes: VOLUME_SIZE_BYTES,
    desiredState: 'present',
    ...overrides,
  };
}

export function desiredCheckpoint(overrides: Partial<DesiredCheckpoint> = {}): DesiredCheckpoint {
  return {
    checkpointId: CHECKPOINT_ID,
    volumeId: VOLUME_ID,
    desiredState: 'present',
    ...overrides,
  };
}

export function desiredExport(overrides: Partial<DesiredExport> = {}): DesiredExport {
  return {
    exportId: EXPORT_ID,
    appId: APP_ID,
    volumeId: VOLUME_ID,
    objectKey: 'exports/app-1/exp-1.tar.gz' as ObjectKey,
    desiredState: 'present',
    ...overrides,
  };
}

export function desiredState(overrides: Partial<HostDesiredState> = {}): HostDesiredState {
  return {
    hostId: HOST_ID,
    generation: 1,
    volumes: [],
    instances: [],
    checkpoints: [],
    exports: [],
    ...overrides,
  };
}

export function observedInstance(overrides: Partial<ObservedInstance> = {}): ObservedInstance {
  return {
    instanceId: INSTANCE_ID,
    appId: APP_ID,
    volumeId: VOLUME_ID,
    deploymentId: DEPLOYMENT_ID,
    present: true,
    running: true,
    exited: false,
    ...overrides,
  };
}

export function observedVolume(overrides: Partial<ObservedVolume> = {}): ObservedVolume {
  return {
    volumeId: VOLUME_ID,
    attached: true,
    sizeBytes: VOLUME_SIZE_BYTES,
    storagePrefix: HOST_STORAGE_PREFIX,
    devicePath: '/dev/nbd0',
    ...overrides,
  };
}

export function observedState(overrides: Partial<ObservedState> = {}): ObservedState {
  return { instances: [], volumes: [], checkpoints: [], exports: [], ...overrides };
}

export const LOG_SOURCE = {
  appId: APP_ID,
  deploymentId: DEPLOYMENT_ID,
  instanceId: INSTANCE_ID,
};

export function tenantLogEvent(sequence = 0): TenantLogEvent {
  return {
    ...LOG_SOURCE,
    kind: 'data',
    sourceId: 'source-1',
    sequence,
    observedAt: OBSERVED_AT,
    stream: 'stdout',
    text: 'hello\n',
  };
}
