import { Path } from '@effect/platform';
import { Config, Effect } from 'effect';

const DEFAULT_STATE_DIR = '/var/lib/nibrun';
const DEFAULT_RUNTIME_DIR = '/run/nibrun';
const DEFAULT_ZEROFS_BINARY = '/opt/nibrun/bin/zerofs/zerofs';
const DEFAULT_ZEROFS_MOUNT = '/mnt/zerofs';
const DEFAULT_ZEROFS_CONFIG = '/etc/zerofs/config.toml';
const DEFAULT_ZEROFS_NBD_SOCKET = '/run/zerofs/nbd.sock';
const DEFAULT_ZEROFS_CHECKPOINT_RUNTIME_DIR = '/run/zerofs-checkpoint';
const DEFAULT_GUEST_IMAGE_DIR = '/opt/nibrun/bin/guest-image';
const DEFAULT_FIRECRACKER_DIR = '/opt/nibrun/bin/firecracker';
const DEFAULT_VERSIONS_FILE = '/opt/nibrun/bundle/versions.json';
const DEFAULT_CADDY_SITES_FILE = '/etc/caddy/rendered/apps.caddy';

const trimmed = (name: string) => Config.map(Config.string(name), (value) => value.trim());

const required = (name: string) =>
  trimmed(name).pipe(
    Config.validate({ message: `${name} is required`, validation: (value) => value.length > 0 }),
  );

const optional = ({ name, fallback }: { name: string; fallback: string }) =>
  trimmed(name).pipe(
    Config.map((value) => value || fallback),
    Config.withDefault(fallback),
  );

const list = (name: string) =>
  trimmed(name).pipe(
    Config.map((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
    Config.withDefault<string[]>([]),
  );

/** An empty list renders no firewall rule at all, so its absence has to stop the agent starting. */
const requiredList = (name: string) =>
  list(name).pipe(
    Config.validate({
      message: `${name} is required`,
      validation: (entries) => entries.length > 0,
    }),
  );

export class AgentConfig extends Effect.Service<AgentConfig>()('AgentConfig', {
  effect: Effect.gen(function* () {
    const path = yield* Path.Path;
    const stateDir = yield* optional({ name: 'AGENT_STATE_DIR', fallback: DEFAULT_STATE_DIR });
    const inStateDir = (name: string) => path.join(stateDir, name);
    return {
      stateDir,
      controlPlaneUrl: yield* required('AGENT_CONTROL_PLANE_URL'),
      // The log store, on a port of its own beside the control channel. Required: an agent that
      // started without it would run correctly and discard every tenant's output, which is the
      // kind of missing config nothing notices until someone asks where the logs went.
      logIngestUrl: yield* required('AGENT_LOG_INGEST_URL'),
      runtimeDir: yield* optional({ name: 'AGENT_RUNTIME_DIR', fallback: DEFAULT_RUNTIME_DIR }),
      hostIdFile: inStateDir('host-id'),
      slotsFile: inStateDir('slots.json'),
      instancesFile: inStateDir('instances.json'),
      exportsFile: inStateDir('exports.json'),
      deletedVolumesFile: inStateDir('deleted-volumes.json'),
      desiredStateFile: inStateDir('desired-state.json'),
      exportStagingDir: inStateDir('exports'),
      artifactCacheDir: inStateDir('artifacts'),
      vmDir: inStateDir('vm'),
      versionsFile: yield* optional({
        name: 'AGENT_VERSIONS_FILE',
        fallback: DEFAULT_VERSIONS_FILE,
      }),
      guestImageDir: yield* optional({
        name: 'AGENT_GUEST_IMAGE_DIR',
        fallback: DEFAULT_GUEST_IMAGE_DIR,
      }),
      firecrackerDir: yield* optional({
        name: 'AGENT_FIRECRACKER_DIR',
        fallback: DEFAULT_FIRECRACKER_DIR,
      }),
      zerofsBinary: yield* optional({
        name: 'AGENT_ZEROFS_BINARY',
        fallback: DEFAULT_ZEROFS_BINARY,
      }),
      zerofsMount: yield* optional({ name: 'AGENT_ZEROFS_MOUNT', fallback: DEFAULT_ZEROFS_MOUNT }),
      zerofsConfigFile: yield* optional({
        name: 'AGENT_ZEROFS_CONFIG_FILE',
        fallback: DEFAULT_ZEROFS_CONFIG,
      }),
      zerofsNbdSocket: yield* optional({
        name: 'AGENT_ZEROFS_NBD_SOCKET',
        fallback: DEFAULT_ZEROFS_NBD_SOCKET,
      }),
      // One directory per checkpoint server below this, created and removed by the unit that
      // serves it — which is why this names the parent rather than a socket.
      zerofsCheckpointRuntimeDir: yield* optional({
        name: 'AGENT_ZEROFS_CHECKPOINT_RUNTIME_DIR',
        fallback: DEFAULT_ZEROFS_CHECKPOINT_RUNTIME_DIR,
      }),
      caddySitesFile: yield* optional({
        name: 'AGENT_CADDY_SITES_FILE',
        fallback: DEFAULT_CADDY_SITES_FILE,
      }),
      zerofsStoragePrefix: yield* required('AGENT_ZEROFS_STORAGE_PREFIX'),
      artifactBucket: yield* required('AGENT_ARTIFACT_BUCKET'),
      exportBucket: yield* required('AGENT_EXPORT_BUCKET'),
      awsRegion: yield* required('AGENT_AWS_REGION'),
      controlPlaneCidrsV4: yield* requiredList('AGENT_CONTROL_PLANE_CIDRS_V4'),
      controlPlaneCidrsV6: yield* requiredList('AGENT_CONTROL_PLANE_CIDRS_V6'),
      guestDnsServers: yield* list('AGENT_GUEST_DNS_SERVERS'),
    } as const;
  }),
}) {}
