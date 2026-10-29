/**
 * Generated from https://raw.githubusercontent.com/ilbertt/nibrunner/v2026.10.7/crates/protocol/schema/desired.schema.json
 * Run bun run --filter @repo/internal-scripts generate-nibrunner-types; do not edit.
 */

/**
 * an identifier
 */
export type CheckpointId = string;
export type DesiredPresence = 'present' | 'absent';
/**
 * an identifier
 */
export type VolumeId = string;
/**
 * an identifier
 */
export type AppId = string;
/**
 * Only complete `${NAME}` references are filled in for NAME in NIBRUN_HOSTNAME, NIBRUN_HTTP_PORT. Bare names, incomplete references and other dollar signs remain literal; complete references to unknown `NIBRUN_` names are refused.
 */
export type TenantValue = string;
/**
 * an identifier
 */
export type ExportId = string;
/**
 * between 1 and 1024 characters
 */
export type ObjectKey = string;
/**
 * an identifier
 */
export type HostId = string;
export type JwtAlgorithm = 'RS256' | 'ES256' | 'EdDSA';
export type JwtTokenFormat = 'raw' | 'bearer';
/**
 * What puts a running microVM back to sleep. Only an `on-request` instance may carry one that
 * fires: nothing else on this host would wake it again, and the next reconcile pass would bring
 * it straight back up.
 */
export type SleepPolicy =
  | {
      kind: 'never';
      [k: string]: unknown;
    }
  | {
      kind: 'traffic-idle';
      timeoutMs: IdleTimeoutMs;
      [k: string]: unknown;
    }
  | {
      kind: 'max-lifetime';
      ttlMs: MaxLifetimeMs;
      [k: string]: unknown;
    };
export type IdleTimeoutMs = number;
export type MaxLifetimeMs = number;
/**
 * The arguments the binary is started with.
 *
 * @maxItems 64
 */
export type TenantArguments = string[];
/**
 * a guest path
 */
export type GuestPath = string;
/**
 * What tells this host an instance is well — and so what a wake waits for before it hands the
 * caller on, and what the instance's liveness is read from after that. Named in every document:
 * a default would be a kind nobody chose, and the one that looks obvious lies. A TCP connect is
 * answered by the guest kernel's accept queue whether or not the process behind it will ever
 * read the request, so a program that has stopped answering passes it for as long as it lives.
 */
export type HealthCheck =
  | {
      gracePeriodMs: number;
      healthyThreshold: number;
      intervalMs: number;
      kind: 'http';
      path: string;
      timeoutMs: number;
      unhealthyThreshold: number;
      [k: string]: unknown;
    }
  | {
      gracePeriodMs: number;
      healthyThreshold: number;
      intervalMs: number;
      kind: 'tcp';
      timeoutMs: number;
      unhealthyThreshold: number;
      [k: string]: unknown;
    }
  | {
      kind: 'boot-completed';
      [k: string]: unknown;
    };
export type GuestPort = number;
/**
 * lowercase letters, digits and dashes, starting with a letter
 */
export type PortName = string;
/**
 * The whole of an instance's activation policy.
 */
export type DesiredInstanceState = 'running' | 'on-request' | 'stopped';
/**
 * a hostname
 */
export type Hostname = string;
export type AppHostnameKind = 'platform' | 'custom';
/**
 * One read-only layer of the root filesystem an instance boots into. Layers stack in the order
 * the document lists them, first at the bottom, and the app's volume is stacked writable over
 * all of them. The kind says what the object is, and so what the host does with it.
 */
export type DesiredLayer =
  | ((
      | StoredObject
      | {
          digest: Sha256Digest;
          repository: OciRepository;
          [k: string]: unknown;
        }
    ) & {
      kind: 'oci';
      [k: string]: unknown;
    })
  | {
      digest: Sha256Digest;
      kind: 'filesystem';
      /**
       * between 1 and 1024 characters
       */
      objectKey: string;
      [k: string]: unknown;
    }
  | {
      destinationPath: ExecutablePath;
      digest: Sha256Digest;
      kind: 'executable';
      /**
       * between 1 and 1024 characters
       */
      objectKey: string;
      [k: string]: unknown;
    };
/**
 * a lowercase hex sha-256
 */
export type Sha256Digest = string;
/**
 * a lowercase registry hostname and repository path, without a scheme, tag or digest
 */
export type OciRepository = string;
/**
 * an absolute path to a file other than /sbin/init
 */
export type ExecutablePath = string;

/**
 * What one host should be running. The daemon watches this document at the path its
 * `paths.desired_state_file` names and converges on every change to it.
 */
export interface HostDesiredState {
  checkpoints: DesiredCheckpoint[];
  exports: DesiredExport[];
  hostId: HostId;
  instances: DesiredInstance[];
  /**
   * What whoever wrote this document calls this version of it, carried back in the report as
   * `acceptedRevision`. Nothing on the host reads it: it is not ordered and not checked
   * against the one before it, so a document may name any version it likes. Required, so that
   * a control plane can always ask which of its own versions a host is on — and so a host
   * answering with one nobody wrote is impossible.
   */
  revision: string;
  volumes: DesiredVolume[];
  [k: string]: unknown;
}
export interface DesiredCheckpoint {
  checkpointId: CheckpointId;
  desiredState: DesiredPresence;
  volumeId: VolumeId;
  [k: string]: unknown;
}
export interface DesiredExport {
  appId: AppId;
  desiredState: DesiredPresence;
  environment?: TenantEnvironment | null;
  exportId: ExportId;
  objectKey: ObjectKey;
  volumeId: VolumeId;
  [k: string]: unknown;
}
export interface TenantEnvironment {
  [k: string]: TenantValue;
}
export interface DesiredInstance {
  /**
   * The access policy for every HTTP hostname.
   */
  access:
    | {
        kind: 'public';
        [k: string]: unknown;
      }
    | {
        algorithm: JwtAlgorithm;
        audiences: string[];
        issuer: string;
        kind: 'jwt';
        /**
         * Supplied PEM public keys or an HTTPS JWKS endpoint.
         */
        publicKeys:
          | string[]
          | {
              url: string;
            };
        token: JwtTokenSource;
      };
  /**
   * What puts this instance to sleep and what tells the host it is ready. A `sleepWhen` other
   * than `never` is refused on anything but an `on-request` instance.
   */
  activation?: ActivationPolicy | null;
  appId: AppId;
  config: AppConfig;
  /**
   * A running instance is replaced when this changes, and only then: a new layer or config
   * under the same `deploymentId` is not picked up.
   */
  deploymentId: string;
  desiredState: DesiredInstanceState;
  /**
   * What the HTTP proxy routes to this app's `httpPort`. Empty for an app nothing outside needs
   * to reach by name.
   */
  hostnames: AppHostname[];
  /**
   * How long an `on-request` instance stays up after its last request before it sleeps: the
   * older spelling of `activation.sleepWhen`, refused beside it. 300000 when neither is named.
   */
  idleTimeoutMs?: IdleTimeoutMs | null;
  /**
   * The root filesystem, bottom layer first. At least one; at most `MAX_LAYERS`.
   *
   * @minItems 1
   * @maxItems 8
   */
  layers:
    | [DesiredLayer]
    | [DesiredLayer, DesiredLayer]
    | [DesiredLayer, DesiredLayer, DesiredLayer]
    | [DesiredLayer, DesiredLayer, DesiredLayer, DesiredLayer]
    | [DesiredLayer, DesiredLayer, DesiredLayer, DesiredLayer, DesiredLayer]
    | [DesiredLayer, DesiredLayer, DesiredLayer, DesiredLayer, DesiredLayer, DesiredLayer]
    | [
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
      ]
    | [
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
        DesiredLayer,
      ];
  /**
   * an identifier
   */
  volumeId: string;
  [k: string]: unknown;
}
export interface JwtTokenSource {
  format: JwtTokenFormat;
  header: string;
}
export interface ActivationPolicy {
  sleepWhen: SleepPolicy;
  [k: string]: unknown;
}
export interface AppConfig {
  command: Command;
  healthCheck: HealthCheck;
  /**
   * The guest port the HTTP proxy sends this app's hostnames to, and the one the health check
   * probes.
   */
  httpPort: number;
  /**
   * What this app answers on besides `httpPort`, if anything.
   */
  ports?: InstancePort[];
  resources: InstanceResources;
  restartPolicy: RestartPolicy;
  [k: string]: unknown;
}
/**
 * What the guest runs once its root is stacked, as uid 65534: `program` with `args`, in
 * `workingDirectory`, with `environment`. The working directory is made if it is not there,
 * given to that uid, and is where the program's persistent state lives, because everything
 * under the root persists on the volume and nowhere else is the program's to write.
 */
export interface Command {
  args: TenantArguments;
  environment: TenantEnvironment;
  program: GuestPath;
  workingDirectory: GuestPath;
  [k: string]: unknown;
}
/**
 * A port a guest answers on beside its HTTP one, carried to it unread.
 *
 * It carries whatever arrives, tcp or udp: a port is a port, the relay in front of a host
 * forwards both for every one in its range, and a guest that listens on only one of them
 * answers the other with a port-unreachable the way any host would.
 */
export interface InstancePort {
  guestPort: GuestPort;
  name: PortName;
  [k: string]: unknown;
}
export interface InstanceResources {
  memoryMib: number;
  vcpuCount: number;
  [k: string]: unknown;
}
export interface RestartPolicy {
  backoffFactor: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  maxRestarts: number;
  resetAfterMs: number;
  [k: string]: unknown;
}
export interface AppHostname {
  hostname: Hostname;
  kind: AppHostnameKind;
  [k: string]: unknown;
}
/**
 * An object in the store the host's `artifacts.store_url` names, checked against `digest`
 * before anything is made from it. The digest is the whole of what is checked: a `sizeBytes`
 * beside it, which a document used to carry, is read past.
 */
export interface StoredObject {
  digest: Sha256Digest;
  /**
   * between 1 and 1024 characters
   */
  objectKey: string;
  [k: string]: unknown;
}
export interface DesiredVolume {
  appId: AppId;
  desiredState: DesiredPresence;
  /**
   * Absent for a volume that starts empty.
   */
  initialContents?: InitialContents | null;
  sizeBytes: number;
  volumeId: VolumeId;
  [k: string]: unknown;
}
/**
 * What a volume holds before its app has written a byte: an archive in the store — a tar,
 * gzipped or not, or a zip — unpacked under `destinationPath` in the app's root as the volume is
 * formatted. That happens once, so this is read once: a volume already formatted is its app's,
 * and a change here does nothing to it.
 */
export interface InitialContents {
  /**
   * a guest path
   */
  destinationPath: string;
  digest: Sha256Digest;
  /**
   * between 1 and 1024 characters
   */
  objectKey: string;
  [k: string]: unknown;
}
