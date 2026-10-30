import { join } from 'node:path';
import { requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';
import { exportLine, runCommand, writeRemoteFile } from '#shared/ssm.ts';

const instanceId = requiredEnv('NIBRUNNER_HOST_INSTANCE_ID');
const hostDirectory = join(repoRoot, 'infra/nibrunner-host');
const versions = (await Bun.file(join(hostDirectory, 'versions.json')).json()) as {
  version: string;
  installerSha256: string;
  binarySha256: string;
};
const configuration = (await Bun.file(join(hostDirectory, 'config.toml.template')).text())
  .replaceAll('{{VPC_IPV4_CIDR_BLOCK}}', requiredEnv('VPC_IPV4_CIDR_BLOCK'))
  .replaceAll('{{VPC_IPV6_CIDR_BLOCK}}', requiredEnv('VPC_IPV6_CIDR_BLOCK'));
const installer = await Bun.file(join(hostDirectory, 'deploy/on_box_deploy.sh')).text();
const tlsInstaller = await Bun.file(join(hostDirectory, 'deploy/install_tls.sh')).text();
const originPullCa = await Bun.file(
  join(repoRoot, 'infra/caddy/cloudflare-origin-pull-ca.pem'),
).text();
const bridgeInstaller = await Bun.file(join(hostDirectory, 'deploy/install_bridge.sh')).text();
const bridgeUnit = await Bun.file(
  join(hostDirectory, 'systemd/nibrun-nibrunner-bridge.service'),
).text();
const bridgeEnvironment = {
  AGENT_ENGINE: 'nibrunner',
  AGENT_CONTROL_PLANE_URL: requiredEnv('AGENT_CONTROL_PLANE_URL'),
  AGENT_ARTIFACT_BUCKET: requiredEnv('AGENT_ARTIFACT_BUCKET'),
  AGENT_IMPORT_BUCKET: requiredEnv('AGENT_IMPORT_BUCKET'),
  AGENT_AWS_REGION: requiredEnv('AGENT_AWS_REGION'),
};
const environmentFile = Object.entries(bridgeEnvironment)
  .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
  .join('\n');
const agentVersion = requiredEnv('GITHUB_SHA');

const script = [
  "bash -se <<'NIBRUNNER_DEPLOY'",
  'set -euo pipefail',
  'timeout 300 cloud-init status --wait',
  'install -d -m 0700 /opt/nibrun/nibrunner-host',
  'cd /opt/nibrun/nibrunner-host',
  'umask 077',
  writeRemoteFile({ name: 'config.toml', content: configuration }),
  writeRemoteFile({ name: 'on_box_deploy.sh', content: installer }),
  writeRemoteFile({ name: 'install_tls.sh', content: tlsInstaller }),
  writeRemoteFile({ name: 'origin-pull-ca.pem', content: originPullCa }),
  writeRemoteFile({ name: 'install_bridge.sh', content: bridgeInstaller }),
  writeRemoteFile({ name: 'nibrun-nibrunner-bridge.service', content: bridgeUnit }),
  writeRemoteFile({ name: 'bridge.env', content: `${environmentFile}\n` }),
  `export ${exportLine({
    NIBRUNNER_VERSION: versions.version,
    NIBRUNNER_INSTALLER_SHA256: versions.installerSha256,
    NIBRUNNER_BINARY_SHA256: versions.binarySha256,
    AWS_REGION: requiredEnv('AWS_REGION'),
    NIBRUNNER_TLS_CERT_PARAMETER: requiredEnv('NIBRUNNER_TLS_CERT_PARAMETER'),
    NIBRUNNER_TLS_KEY_PARAMETER: requiredEnv('NIBRUNNER_TLS_KEY_PARAMETER'),
    AGENT_VERSION: agentVersion,
    AGENT_URL: requiredEnv('AGENT_URL'),
    AGENT_SHA256: requiredEnv('AGENT_SHA256'),
    AGENT_AWS_REGION: bridgeEnvironment.AGENT_AWS_REGION,
  })}`,
  'bash on_box_deploy.sh',
  'bash install_bridge.sh',
  'NIBRUNNER_DEPLOY',
].join('\n');

await runCommand({
  instanceId,
  script,
  comment: `Deploy nibrunner ${versions.version} bridge ${agentVersion}`,
});
