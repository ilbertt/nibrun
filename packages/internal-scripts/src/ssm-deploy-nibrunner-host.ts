import { join } from 'node:path';
import {
  NIBRUNNER_EXPORTS_DIRECTORY,
  NIBRUNNER_FILESYSTEM_SOCKET,
  NIBRUNNER_GUEST_CONNECTIONS_SOCKET,
} from '@repo/global-constants';
import { requireMainWorkflow } from '#shared/actions.ts';
import { requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';
import { exportLine, runCommand, writeRemoteFile } from '#shared/ssm.ts';

requireMainWorkflow();

const instanceId = requiredEnv('NIBRUNNER_HOST_INSTANCE_ID');
const hostDirectory = join(repoRoot, 'infra/nibrunner-host');
const versions = (await Bun.file(join(hostDirectory, 'versions.json')).json()) as {
  version: string;
  binarySha256: string;
};
const guestVersion = requiredEnv('NIBRUNNER_GUEST_IMAGE_VERSION');
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}$/.test(guestVersion)) {
  throw new Error('The guest image version is not a safe directory name.');
}
const guestDirectory = `/var/lib/nibrunner/guest-images/${guestVersion}`;
const configuration = (await Bun.file(join(hostDirectory, 'config.toml.template')).text())
  .replaceAll('{{VPC_IPV4_CIDR_BLOCK}}', requiredEnv('VPC_IPV4_CIDR_BLOCK'))
  .replaceAll('{{VPC_IPV6_CIDR_BLOCK}}', requiredEnv('VPC_IPV6_CIDR_BLOCK'))
  .replaceAll('{{GUEST_IMAGE_DIRECTORY}}', JSON.stringify(guestDirectory))
  .replaceAll('{{EXPORTS_DIRECTORY}}', JSON.stringify(NIBRUNNER_EXPORTS_DIRECTORY))
  .replaceAll(
    '{{EXPORTS_STAGING_DIRECTORY}}',
    JSON.stringify(join(NIBRUNNER_EXPORTS_DIRECTORY, 'staging')),
  )
  .replaceAll('{{ZEROFS_STORAGE_URL}}', JSON.stringify(requiredEnv('NIBRUNNER_ZEROFS_STORAGE_URL')))
  .replaceAll('{{FILESYSTEM_SOCKET}}', JSON.stringify(NIBRUNNER_FILESYSTEM_SOCKET))
  .replaceAll('{{GUEST_CONNECTIONS_SOCKET}}', JSON.stringify(NIBRUNNER_GUEST_CONNECTIONS_SOCKET))
  .replaceAll(
    '{{FALLBACK_ORIGIN_HOST}}',
    JSON.stringify(requiredEnv('NIBRUNNER_FALLBACK_ORIGIN_HOST')),
  )
  .replaceAll('{{FALLBACK_REDIRECT}}', JSON.stringify(requiredEnv('NIBRUNNER_FALLBACK_REDIRECT')));
const installer = await Bun.file(join(hostDirectory, 'deploy/on_box_deploy.sh')).text();
const aptConfiguration = await Bun.file(join(hostDirectory, 'apt.conf')).text();
const storageEnvironmentInstaller = await Bun.file(
  join(hostDirectory, 'deploy/install_storage_environment.sh'),
).text();
const tunnelInstaller = await Bun.file(join(hostDirectory, 'deploy/install_tunnel.sh')).text();
const tunnelUnit = await Bun.file(
  join(hostDirectory, 'systemd/nibrun-nibrunner-tunnel.service'),
).text();
const bridgeInstaller = await Bun.file(join(hostDirectory, 'deploy/install_bridge.sh')).text();
const bridgeUnit = await Bun.file(join(hostDirectory, 'systemd/nibrun-nibrunner-bridge.service'))
  .text()
  .then((unit) => unit.replaceAll('{{EXPORTS_DIRECTORY}}', NIBRUNNER_EXPORTS_DIRECTORY));
const bridgeEnvironment = {
  AGENT_ENGINE: 'nibrunner',
  AGENT_CONTROL_PLANE_URL: requiredEnv('AGENT_CONTROL_PLANE_URL'),
  AGENT_LOG_INGEST_URL: requiredEnv('AGENT_LOG_INGEST_URL'),
  AGENT_ARTIFACT_BUCKET: requiredEnv('AGENT_ARTIFACT_BUCKET'),
  AGENT_IMPORT_BUCKET: requiredEnv('AGENT_IMPORT_BUCKET'),
  AGENT_EXPORT_BUCKET: requiredEnv('AGENT_EXPORT_BUCKET'),
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
  writeRemoteFile({ name: 'apt.conf', content: aptConfiguration }),
  writeRemoteFile({ name: 'install_storage_environment.sh', content: storageEnvironmentInstaller }),
  writeRemoteFile({ name: 'install_tunnel.sh', content: tunnelInstaller }),
  writeRemoteFile({ name: 'nibrun-nibrunner-tunnel.service', content: tunnelUnit }),
  writeRemoteFile({ name: 'install_bridge.sh', content: bridgeInstaller }),
  writeRemoteFile({ name: 'nibrun-nibrunner-bridge.service', content: bridgeUnit }),
  writeRemoteFile({ name: 'bridge.env', content: `${environmentFile}\n` }),
  `export ${exportLine({
    NIBRUNNER_VERSION: versions.version,
    NIBRUNNER_BINARY_SHA256: versions.binarySha256,
    NIBRUNNER_GUEST_IMAGE_URL: requiredEnv('NIBRUNNER_GUEST_IMAGE_URL'),
    NIBRUNNER_GUEST_IMAGE_SHA256: requiredEnv('NIBRUNNER_GUEST_IMAGE_SHA256'),
    AWS_REGION: requiredEnv('AWS_REGION'),
    NIBRUNNER_ZEROFS_ENCRYPTION_PASSWORD_PARAMETER: requiredEnv(
      'NIBRUNNER_ZEROFS_ENCRYPTION_PASSWORD_PARAMETER',
    ),
    NIBRUNNER_CLOUDFLARED_TOKEN_PARAMETER: requiredEnv('NIBRUNNER_CLOUDFLARED_TOKEN_PARAMETER'),
    AGENT_VERSION: agentVersion,
    AGENT_URL: requiredEnv('AGENT_URL'),
    AGENT_SHA256: requiredEnv('AGENT_SHA256'),
    AGENT_AWS_REGION: bridgeEnvironment.AGENT_AWS_REGION,
  })}`,
  'bash on_box_deploy.sh',
  'bash install_bridge.sh',
  'bash install_tunnel.sh',
  'NIBRUNNER_DEPLOY',
].join('\n');

await runCommand({
  instanceId,
  script,
  comment: `Deploy nibrunner ${versions.version} bridge ${agentVersion}`,
});
