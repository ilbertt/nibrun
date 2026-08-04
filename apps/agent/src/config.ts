import { join } from 'node:path';

const DEFAULT_STATE_DIR = '/var/lib/nibrun';
const DEFAULT_RUNTIME_DIR = '/run/nibrun';
// Laid down by the deploy under a versioned path with a symlink to the active one, like
// every other binary on this host. Not on PATH, so it is named in full.
const DEFAULT_ZEROFS_BINARY = '/opt/nibrun/bin/zerofs/zerofs';
const DEFAULT_ZEROFS_MOUNT = '/mnt/zerofs';
const DEFAULT_ZEROFS_CONFIG = '/etc/zerofs/config.toml';
const DEFAULT_ZEROFS_NBD_SOCKET = '/run/zerofs/nbd.sock';
const DEFAULT_GUEST_IMAGE_DIR = '/opt/nibrun/bin/guest-image';
const DEFAULT_FIRECRACKER_DIR = '/opt/nibrun/bin/firecracker';
const DEFAULT_VERSIONS_FILE = '/opt/nibrun/bundle/versions.json';
// Glob-imported by the Caddyfile the deploy installs, into a directory the deploy owns.
const DEFAULT_CADDY_SITES_FILE = '/etc/caddy/rendered/apps.caddy';

export const NBD_CONNECTIONS = 4;
export const NBD_BLOCK_SIZE_BYTES = 4096;
// S3 round trips under load are slow enough that a short NBD timeout turns a stall into an
// EIO the guest's ext4 answers by remounting read-only.
export const NBD_TIMEOUT_SECONDS = 600;

export type AgentConfig = {
  controlPlaneUrl: string;
  stateDir: string;
  runtimeDir: string;
  hostIdFile: string;
  slotsFile: string;
  instancesFile: string;
  exportsFile: string;
  exportStagingDir: string;
  artifactCacheDir: string;
  vmDir: string;
  versionsFile: string;
  guestImageDir: string;
  firecrackerDir: string;
  zerofsMount: string;
  zerofsBinary: string;
  zerofsConfigFile: string;
  zerofsNbdSocket: string;
  caddySitesFile: string;
  // The `[storage] url` prefix this host's ZeroFS is pointed at. A volume naming a different
  // one is refused rather than created here, because a device file written into the wrong
  // filesystem puts a tenant's data somewhere nothing will look for it.
  zerofsStoragePrefix: string;
  artifactBucket: string;
  // Write-only for this host by IAM, so a bundle it has already produced is unreadable to it.
  // What was written is therefore remembered in `exportsFile` rather than observed, which is the
  // one place the agent cannot converge against reality.
  exportBucket: string;
  awsRegion: string;
  // The VPC, named rather than left to the blanket private-destination rule that happens to
  // contain it. Required, because an empty list renders no rule and the redundancy that makes
  // its absence survivable is also what would hide it.
  controlPlaneCidrsV4: string[];
  // The same VPC in the family with no blanket rule behind it: AWS allocates VPC IPv6 from
  // global unicast, so nothing but this denies it.
  controlPlaneCidrsV6: string[];
  // Empty by default, which leaves guests reaching a public resolver over the ordinary egress
  // path. The VPC resolver sits inside RFC1918 and is therefore blocked with everything else,
  // so naming it here is the only way to allow it without weakening the blanket rule.
  guestDnsServers: string[];
};

class MissingConfigurationError extends Error {
  constructor(name: string) {
    super(`${name} is required`);
    this.name = 'MissingConfigurationError';
  }
}

function required({ env, name }: { env: Record<string, string | undefined>; name: string }) {
  const value = env[name]?.trim();
  if (!value) {
    throw new MissingConfigurationError(name);
  }
  return value;
}

function optional({
  env,
  name,
  fallback,
}: {
  env: Record<string, string | undefined>;
  name: string;
  fallback: string;
}) {
  return env[name]?.trim() || fallback;
}

function list({ env, name }: { env: Record<string, string | undefined>; name: string }) {
  return (env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * A list whose absence is a failure to start rather than an empty one.
 *
 * The difference matters only for values a firewall rule is rendered from: an empty list drops
 * the rule, so a variable that never arrived would leave the agent running with a ruleset one
 * denial short and nothing anywhere saying so.
 */
function requiredList({ env, name }: { env: Record<string, string | undefined>; name: string }) {
  const values = list({ env, name });
  if (values.length === 0) {
    throw new MissingConfigurationError(name);
  }
  return values;
}

export function loadAgentConfig({
  env = Bun.env,
}: {
  env?: Record<string, string | undefined>;
} = {}): AgentConfig {
  const stateDir = optional({ env, name: 'AGENT_STATE_DIR', fallback: DEFAULT_STATE_DIR });
  return {
    controlPlaneUrl: required({ env, name: 'AGENT_CONTROL_PLANE_URL' }),
    stateDir,
    runtimeDir: optional({ env, name: 'AGENT_RUNTIME_DIR', fallback: DEFAULT_RUNTIME_DIR }),
    hostIdFile: join(stateDir, 'host-id'),
    slotsFile: join(stateDir, 'slots.json'),
    instancesFile: join(stateDir, 'instances.json'),
    exportsFile: join(stateDir, 'exports.json'),
    exportStagingDir: join(stateDir, 'exports'),
    artifactCacheDir: join(stateDir, 'artifacts'),
    vmDir: join(stateDir, 'vm'),
    versionsFile: optional({ env, name: 'AGENT_VERSIONS_FILE', fallback: DEFAULT_VERSIONS_FILE }),
    guestImageDir: optional({
      env,
      name: 'AGENT_GUEST_IMAGE_DIR',
      fallback: DEFAULT_GUEST_IMAGE_DIR,
    }),
    firecrackerDir: optional({
      env,
      name: 'AGENT_FIRECRACKER_DIR',
      fallback: DEFAULT_FIRECRACKER_DIR,
    }),
    zerofsBinary: optional({
      env,
      name: 'AGENT_ZEROFS_BINARY',
      fallback: DEFAULT_ZEROFS_BINARY,
    }),
    zerofsMount: optional({ env, name: 'AGENT_ZEROFS_MOUNT', fallback: DEFAULT_ZEROFS_MOUNT }),
    zerofsConfigFile: optional({
      env,
      name: 'AGENT_ZEROFS_CONFIG_FILE',
      fallback: DEFAULT_ZEROFS_CONFIG,
    }),
    zerofsNbdSocket: optional({
      env,
      name: 'AGENT_ZEROFS_NBD_SOCKET',
      fallback: DEFAULT_ZEROFS_NBD_SOCKET,
    }),
    caddySitesFile: optional({
      env,
      name: 'AGENT_CADDY_SITES_FILE',
      fallback: DEFAULT_CADDY_SITES_FILE,
    }),
    zerofsStoragePrefix: required({ env, name: 'AGENT_ZEROFS_STORAGE_PREFIX' }),
    artifactBucket: required({ env, name: 'AGENT_ARTIFACT_BUCKET' }),
    exportBucket: required({ env, name: 'AGENT_EXPORT_BUCKET' }),
    awsRegion: required({ env, name: 'AGENT_AWS_REGION' }),
    controlPlaneCidrsV4: requiredList({ env, name: 'AGENT_CONTROL_PLANE_CIDRS_V4' }),
    controlPlaneCidrsV6: requiredList({ env, name: 'AGENT_CONTROL_PLANE_CIDRS_V6' }),
    guestDnsServers: list({ env, name: 'AGENT_GUEST_DNS_SERVERS' }),
  };
}
