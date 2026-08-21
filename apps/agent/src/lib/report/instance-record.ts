import type {
  AppHostname,
  AppId,
  DeploymentId,
  GuestPort,
  HealthCheck,
  HostPort,
  InstanceResources,
  InstanceState,
  Ipv4Address,
  Sha256Digest,
  Timestamp,
  VolumeId,
} from '@repo/protocol';
import type { AttemptWindow } from '#lib/backoff.ts';
import type { GraceInputs, HealthTracker } from '#lib/health/state.ts';

const NO_RESTARTS = 0;
const NO_ATTEMPTS = 0;

/**
 * A cache, not an authority: systemd is what is actually running, and a record that cannot be
 * read back is discarded rather than trusted. Routing is rendered straight from these.
 */
export type InstanceRecord = {
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

/** A budget nothing has spent: what an instance is born with, and what a deliberate stop gives back. */
export const NO_START_ATTEMPTS: AttemptWindow = { attempts: NO_ATTEMPTS };

export const newInstanceRecord = (
  fields: Omit<InstanceRecord, 'restartCount' | 'startAttempts' | 'stopRequested'>,
): InstanceRecord => ({
  ...fields,
  restartCount: NO_RESTARTS,
  startAttempts: NO_START_ATTEMPTS,
  stopRequested: false,
});

/**
 * What every health decision about a record needs, in the one place that knows `startedAt` is a
 * wire timestamp here and a clock reading there — and that a record this agent never started has
 * no start time at all.
 */
export function graceInputs({
  record,
  nowMs,
}: {
  record: InstanceRecord;
  nowMs: number;
}): GraceInputs {
  return {
    healthCheck: record.healthCheck,
    ...(record.startedAt ? { startedAtMs: Date.parse(record.startedAt) } : {}),
    nowMs,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const REQUIRED_STRING_FIELDS = [
  'appId',
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
