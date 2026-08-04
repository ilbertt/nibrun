import type {
  AppHostname,
  AppId,
  DeploymentId,
  GuestPort,
  HealthCheck,
  HostPort,
  InstanceId,
  InstanceResources,
  InstanceState,
  Ipv4Address,
  Sha256Digest,
  Timestamp,
  VolumeId,
} from '@repo/protocol';
import type { HealthTracker } from '#health/state.ts';
import type { AttemptWindow } from '#lib/backoff.ts';

const NO_RESTARTS = 0;
const NO_ATTEMPTS = 0;

/**
 * A cache, not an authority: systemd is what is actually running, and a record that cannot be
 * read back is discarded rather than trusted. Routing is rendered straight from these.
 */
export type InstanceRecord = {
  readonly instanceId: InstanceId;
  readonly appId: AppId;
  readonly deploymentId: DeploymentId;
  readonly volumeId: VolumeId;
  readonly hostnames: readonly AppHostname[];
  readonly hostPort: HostPort;
  readonly guestPort: GuestPort;
  readonly guestIpv4: Ipv4Address;
  readonly artifactDigest: Sha256Digest;
  readonly state: InstanceState;
  readonly health: HealthTracker;
  readonly healthCheck: HealthCheck;
  readonly resources: InstanceResources;
  readonly desiredRunning: boolean;
  readonly startAttempts: AttemptWindow;
  readonly restartCount: number;
  readonly stopRequested: boolean;
  readonly startedAt?: Timestamp;
  readonly lastExitCode?: number;
  readonly message?: string;
};

export const newInstanceRecord = (
  fields: Omit<InstanceRecord, 'restartCount' | 'startAttempts' | 'stopRequested'>,
): InstanceRecord => ({
  ...fields,
  restartCount: NO_RESTARTS,
  startAttempts: { attempts: NO_ATTEMPTS },
  stopRequested: false,
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const REQUIRED_STRING_FIELDS = [
  'instanceId',
  'appId',
  'deploymentId',
  'volumeId',
  'guestIpv4',
  'artifactDigest',
  'state',
] as const;

const REQUIRED_NUMBER_FIELDS = ['hostPort', 'guestPort', 'restartCount'] as const;

/** Structural rather than schema-driven: these are the agent's own notes, and the recovery for an
 * unreadable one is to re-derive it from systemd rather than to reject the file. */
export function isInstanceRecord(value: unknown): value is InstanceRecord {
  if (!isObject(value)) {
    return false;
  }
  return (
    REQUIRED_STRING_FIELDS.every((field) => typeof value[field] === 'string') &&
    REQUIRED_NUMBER_FIELDS.every((field) => typeof value[field] === 'number') &&
    Array.isArray(value.hostnames) &&
    isObject(value.health)
  );
}

export function readInstanceRecords(value: unknown): InstanceRecord[] {
  return Array.isArray(value) ? value.filter(isInstanceRecord) : [];
}
