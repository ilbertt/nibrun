import {
  type AppId,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
  type DeploymentId,
  type GuestPort,
  type HostDesiredState,
  type HostId,
  type Hostname,
  type HostReportedState,
  type InstanceId,
  type ObjectKey,
  type SecretString,
  type Sha256Digest,
  type VolumeId,
} from '@repo/protocol';
import { Repository } from '#repositories/repository.ts';

// Where the schema goes when there is one. Until then one app, written out here,
// which is what a control plane with no database can honestly offer: the shape is
// exactly what a query will return, so replacing this is replacing the body of
// `desiredState` and nothing above it.
//
// PocketBase rather than something of ours, deliberately — it is a released
// third-party binary that needs a subcommand, writes to a directory it is told
// about, and binds a port it is told about. A tenant we did not build is the only
// kind that tests the contract instead of agreeing with it.
const APP_ID = 'app-pocketbase' as AppId;

// Every volume on a host repeats the one prefix that host's ZeroFS serves, and the
// agent refuses a prefix it does not serve. The host composes its own from IMDS, so
// this value is the instance id of the machine as it stands and does not survive a
// replacement — see the note in the pull request. A host reporting the prefixes it
// serves is what removes the need to know this here.
const STORAGE_PREFIX =
  's3://nibrun-filesystems-eu-central-1/hosts/i-04d1d0f91bd5e41e5' as ObjectKey;

const VOLUME_SIZE_BYTES = 8_589_934_592;

const POCKETBASE_PORT = 8090 as GuestPort;

const DESIRED_APP = {
  generation: 2,
  volumes: [
    {
      volumeId: 'vol-pocketbase' as VolumeId,
      appId: APP_ID,
      sizeBytes: VOLUME_SIZE_BYTES,
      storagePrefix: STORAGE_PREFIX,
      desiredState: 'present',
    },
  ],
  instances: [
    {
      instanceId: 'inst-pocketbase-1' as InstanceId,
      appId: APP_ID,
      deploymentId: 'dep-pocketbase-1' as DeploymentId,
      volumeId: 'vol-pocketbase' as VolumeId,
      desiredState: 'running',
      artifact: {
        // Uploaded by hand; the agent hashes the stream as it downloads and refuses
        // on either mismatch, so both values below are load-bearing.
        objectKey: 'artifacts/app-pocketbase/pb-0-39-10' as ObjectKey,
        digest: 'f119018534e7a9e0db837c2811dda589d03bbdb78a03decc0664aac864e53814' as Sha256Digest,
        sizeBytes: 32_096_418,
      },
      config: {
        guestPort: POCKETBASE_PORT,
        // `serve` because the binary is a multi-command tool; 0.0.0.0 because the
        // host forwards into the guest and loopback would not be reachable; --dir
        // because PocketBase writes beside its working directory by default, which
        // is the tmpfs at /app rather than the volume that survives a restart.
        args: ['serve', `--http=0.0.0.0:${POCKETBASE_PORT}`, '--dir=/app/data/pb_data'],
        environment: {},
        resources: DEFAULT_INSTANCE_RESOURCES,
        healthCheck: DEFAULT_HEALTH_CHECK,
        restartPolicy: DEFAULT_RESTART_POLICY,
      },
      hostnames: [
        { hostname: 'pocketbase.canister.site' as Hostname, kind: 'platform', isDefault: true },
      ],
    },
  ],
  checkpoints: [],
  exports: [],
} satisfies Omit<HostDesiredState, 'hostId'>;

export class AgentRepository extends Repository {
  // In this process rather than in Postgres, which is the one thing here that is
  // not simply "a table is missing": a session is ephemeral, so losing the map
  // when the api restarts costs a re-registration the agent already retries.
  // Every other read below is a query waiting to be written.
  readonly #hostBySession = new Map<string, HostId>();

  saveSession({
    sessionToken,
    hostId,
  }: {
    sessionToken: SecretString;
    hostId: HostId;
  }): Promise<void> {
    this.#hostBySession.set(sessionToken, hostId);
    return Promise.resolve();
  }

  hostForSession({ sessionToken }: { sessionToken: string }): Promise<HostId | undefined> {
    return Promise.resolve(this.#hostBySession.get(sessionToken));
  }

  desiredState({ hostId }: { hostId: HostId }): Promise<HostDesiredState> {
    return Promise.resolve({ hostId, ...DESIRED_APP });
  }

  // Reported state is the fleet's view of itself and belongs beside the desired
  // state it answers. Dropped rather than held in memory: an in-process copy
  // would be a second source of truth to unpick later.
  saveReportedState(_: { reported: HostReportedState }): Promise<void> {
    return Promise.resolve();
  }
}
