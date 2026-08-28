import {
  type AppHostname,
  AppIdSchema,
  CheckpointIdSchema,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_HTTP_PORT,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
  DeploymentIdSchema,
  type DesiredArtifact,
  type DesiredCheckpoint,
  type DesiredExport,
  type DesiredInstance,
  type DesiredVolume,
  ExportIdSchema,
  FilenameSchema,
  type HostDesiredState,
  HostIdSchema,
  HostnameSchema,
  HostPortSchema,
  ObjectKeySchema,
  SecretStringSchema,
  type TenantEnvironment,
  TimestampSchema,
  Value,
  VolumeIdSchema,
} from '@repo/protocol';
import { initialTracker } from '#lib/health/state.ts';
import type { TenantLogEvent } from '#lib/logs/event.ts';
import { describeSlot, FIRST_SLOT, HOST_PORT_BASE } from '#lib/network/slot.ts';
import type { ObservedInstance, ObservedState, ObservedVolume } from '#lib/reconcile/plan.ts';
import { type InstanceRecord, newInstanceRecord } from '#lib/report/instance-record.ts';
import { ARTIFACT_BYTES, ARTIFACT_DIGEST } from '#tests/support/artifacts.ts';
import { HOST_STORAGE_PREFIX } from '#tests/support/config.ts';

export const APP_ID = Value.Parse(AppIdSchema, 'app-1');
export const VOLUME_ID = Value.Parse(VolumeIdSchema, 'vol-1');
export const DEPLOYMENT_ID = Value.Parse(DeploymentIdSchema, 'dep-1');
export const HOST_ID = Value.Parse(HostIdSchema, 'host-1');
export const CHECKPOINT_ID = Value.Parse(CheckpointIdSchema, 'chk-1');
export const EXPORT_ID = Value.Parse(ExportIdSchema, 'exp-1');
export const OBSERVED_AT = Value.Parse(TimestampSchema, '2026-08-03T10:00:00.000Z');

export const VOLUME_SIZE_BYTES = 4_096;
export const FIRST_HOST_PORT = Value.Parse(HostPortSchema, HOST_PORT_BASE);

export const APP_HOSTNAME: AppHostname = {
  hostname: Value.Parse(HostnameSchema, 'app-1.apps.example.com'),
  kind: 'platform',
};

/** A tenant's own variables, which are secrets wherever they are typed — including in a test. */
export function tenantEnvironment(values: Record<string, string>): TenantEnvironment {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, Value.Parse(SecretStringSchema, value)]),
  );
}

export function artifact(overrides: Partial<DesiredArtifact> = {}): DesiredArtifact {
  return {
    digest: ARTIFACT_DIGEST,
    sizeBytes: ARTIFACT_BYTES.byteLength,
    // A uuid, as the api will assign: it carries no name, which is why `filename` exists.
    objectKey: Value.Parse(ObjectKeySchema, 'artifacts/9f1c2f0e-0d4e-4a1b-9c3a-1f8b6d2e7a45'),
    filename: Value.Parse(FilenameSchema, 'pocketbase'),
    ...overrides,
  };
}

export function desiredInstance(overrides: Partial<DesiredInstance> = {}): DesiredInstance {
  return {
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    volumeId: VOLUME_ID,
    desiredState: 'running',
    artifact: artifact(),
    config: {
      httpPort: DEFAULT_HTTP_PORT,
      hasExtraPublicPort: false,
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
    objectKey: Value.Parse(ObjectKeySchema, 'exports/app-1/exp-1.tar.gz'),
    artifact: artifact(),
    environment: {},
    desiredState: 'present',
    ...overrides,
  };
}

export function desiredState(overrides: Partial<HostDesiredState> = {}): HostDesiredState {
  return {
    hostId: HOST_ID,
    volumes: [],
    instances: [],
    checkpoints: [],
    exports: [],
    ...overrides,
  };
}

export function instanceRecord(overrides: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    ...newInstanceRecord({
      appId: APP_ID,
      deploymentId: DEPLOYMENT_ID,
      volumeId: VOLUME_ID,
      hostnames: [APP_HOSTNAME],
      hostPort: FIRST_HOST_PORT,
      httpPort: DEFAULT_HTTP_PORT,
      guestIpv4: describeSlot({ slot: FIRST_SLOT, appId: APP_ID }).guestIpv4,
      artifactDigest: ARTIFACT_DIGEST,
      state: 'running',
      health: initialTracker(),
      healthCheck: DEFAULT_HEALTH_CHECK,
      resources: DEFAULT_INSTANCE_RESOURCES,
      desiredRunning: true,
    }),
    ...overrides,
  };
}

export function observedInstance(overrides: Partial<ObservedInstance> = {}): ObservedInstance {
  return {
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
    appId: APP_ID,
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
