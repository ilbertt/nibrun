/**
 * Generated from https://raw.githubusercontent.com/ilbertt/nibrunner/v2026.10.7/crates/protocol/schema/reported.schema.json
 * Run bun run --filter @repo/internal-scripts generate-nibrunner-types; do not edit.
 */

/**
 * a lowercase hex sha-256
 */
export type Sha256Digest = string;
/**
 * between 1 and 128 printable characters, without spaces
 */
export type Revision = string;
/**
 * an identifier
 */
export type CheckpointId = string;
export type StateMessage = string;
/**
 * an ISO 8601 instant with an offset
 */
export type Timestamp = string;
export type CheckpointState = 'pending' | 'ready' | 'deleted' | 'failed';
/**
 * an identifier
 */
export type VolumeId = string;
/**
 * an identifier
 */
export type ExportId = string;
export type ExportState = 'pending' | 'preparing' | 'ready' | 'failed' | 'expired';
/**
 * an identifier
 */
export type HostId = string;
/**
 * an identifier
 */
export type AppId = string;
/**
 * an identifier
 */
export type DeploymentId = string;
/**
 * an IPv4 address
 */
export type Ipv4Address = string;
export type HostPort = number;
/**
 * How a tenant process ended: the code it exited with, or the signal that killed it.
 */
export type TenantExit =
  | {
      code: number;
    }
  | {
      signal: number;
    };
export type InstanceState =
  | 'pending'
  | 'starting'
  | 'running'
  | 'unhealthy'
  | 'stopping'
  | 'stopped'
  | 'idle'
  | 'failed';
export type HostState = 'registering' | 'ready' | 'draining' | 'unreachable';
export type VolumeState = 'pending' | 'ready' | 'detached' | 'deleted' | 'failed';
/**
 * between 1 and 1024 characters
 */
export type ObjectKey = string;

/**
 * What one host is running, as the daemon last wrote it to `reported.json` in its
 * `paths.state_dir`.
 */
export interface HostReportedState {
  /**
   * The document this host is converging on, as `sha256sum` reads the file it came from.
   * Absent until one has been taken up. A control plane checks it against the write it made
   * to learn that this host is on that document rather than on the one before it — which is
   * what `instances` alone cannot say about a document that changed nothing about an app.
   */
  acceptedDigest?: Sha256Digest | null;
  /**
   * The `revision` that document named, if it named one — the control plane's own word for
   * what this host is converging on, beside the digest that is this host's.
   */
  acceptedRevision?: Revision | null;
  allocatable: HostCapacity;
  capacity: HostCapacity1;
  checkpoints: ReportedCheckpoint[];
  exports: ReportedExport[];
  hostId: HostId;
  instances: ReportedInstance[];
  /**
   * Set when the last document this host was handed was refused — malformed, or not the
   * document this host reads — and cleared when a readable one is taken up. A control plane
   * that only reads this file learns from it that its last write did not land, and why.
   */
  message?: StateMessage | null;
  reportedAt: Timestamp;
  state: HostState;
  versions: HostVersions;
  volumes: ReportedVolume[];
  [k: string]: unknown;
}
/**
 * What is left once every booted app is taken off.
 */
export interface HostCapacity {
  cacheBytes: number;
  memoryMib: number;
  vcpuCount: number;
  [k: string]: unknown;
}
/**
 * What the machine has.
 */
export interface HostCapacity1 {
  cacheBytes: number;
  memoryMib: number;
  vcpuCount: number;
  [k: string]: unknown;
}
export interface ReportedCheckpoint {
  checkpointId: CheckpointId;
  message?: StateMessage | null;
  readyAt?: Timestamp | null;
  reference?: StateMessage | null;
  state: CheckpointState;
  volumeId: VolumeId;
  [k: string]: unknown;
}
export interface ReportedExport {
  checkpointId?: CheckpointId | null;
  exportId: ExportId;
  message?: StateMessage | null;
  readyAt?: Timestamp | null;
  sizeBytes?: number | null;
  state: ExportState;
  [k: string]: unknown;
}
export interface ReportedInstance {
  appId: AppId;
  /**
   * When the instance first became what the document asks of it, for the `deploymentId` and
   * `desiredState` it now carries. Absent while it is still on its way there, and for a
   * deployment this host was not there to see arrive.
   */
  convergedAt?: Timestamp | null;
  deploymentId: DeploymentId;
  guestIpv4?: Ipv4Address | null;
  hostPort?: HostPort | null;
  lastExitCode?: number | null;
  /**
   * The last of those restarts. Absent until there has been one.
   */
  lastRestart?: ReportedRestart | null;
  /**
   * The layers the running microVM was booted from, bottom first. Empty until one has been.
   */
  layerDigests?: Sha256Digest[];
  message?: StateMessage | null;
  /**
   * Times the supervisor inside the guest has restarted the tenant since this host last booted
   * the app afresh. A restore from a snapshot keeps the count; a cold boot starts it over.
   */
  restartCount: number;
  startedAt?: Timestamp | null;
  state: InstanceState;
  [k: string]: unknown;
}
/**
 * A tenant restart as the host heard of it: what the guest said, and when it said it.
 */
export interface ReportedRestart {
  at: Timestamp;
  /**
   * 1 for the first restart since the tenant last stayed up long enough to earn its budget
   * back, up to `budget`.
   */
  attempt: number;
  backoffMs: number;
  budget: number;
  exit: TenantExit;
  reason: StateMessage;
  [k: string]: unknown;
}
export interface HostVersions {
  agent: string;
  firecracker: string;
  guestImage: string;
  zerofs: string;
  [k: string]: unknown;
}
export interface ReportedVolume {
  appId: AppId;
  devicePath?: string | null;
  message?: StateMessage | null;
  sizeBytes: number;
  state: VolumeState;
  storagePrefix?: ObjectKey | null;
  volumeId: VolumeId;
  [k: string]: unknown;
}
