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
 * What the agent knows about one instance, in the shape the routing layer will want to read.
 *
 * Hostname, host-side port and health sit at the top level rather than being reachable only by
 * replaying the boot path, so the local proxy's config can be rendered straight from this when
 * it is built. That is the whole reason there is no routing table in the control plane: the
 * process that knows what is running is the process that writes the routing config.
 *
 * It is a cache, not an authority. Systemd is what is actually running, and a record that
 * cannot be read back is discarded rather than trusted.
 */
export type InstanceRecord = {
  instanceId: InstanceId;
  appId: AppId;
  deploymentId: DeploymentId;
  volumeId: VolumeId;
  hostnames: AppHostname[];
  hostPort: HostPort;
  guestPort: GuestPort;
  guestIpv4: Ipv4Address;
  artifactDigest: Sha256Digest;
  state: InstanceState;
  health: HealthTracker;
  healthCheck: HealthCheck;
  resources: InstanceResources;
  desiredRunning: boolean;
  startAttempts: AttemptWindow;
  restartCount: number;
  stopRequested: boolean;
  startedAt?: Timestamp;
  lastExitCode?: number;
  message?: string;
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

// Deliberately structural rather than schema-driven: these are the agent's own notes, not a
// message from another program, and the recovery for an unreadable one is to re-derive it from
// what systemd reports rather than to reject the file.
export function isInstanceRecord(value: unknown): value is InstanceRecord {
  if (!isObject(value)) {
    return false;
  }
  const hasStrings = REQUIRED_STRING_FIELDS.every((field) => typeof value[field] === 'string');
  const hasNumbers = REQUIRED_NUMBER_FIELDS.every((field) => typeof value[field] === 'number');
  return hasStrings && hasNumbers && Array.isArray(value.hostnames) && isObject(value.health);
}

export function readInstanceRecords(value: unknown): InstanceRecord[] {
  return Array.isArray(value) ? value.filter(isInstanceRecord) : [];
}
