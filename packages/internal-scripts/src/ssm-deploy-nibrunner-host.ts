import { join } from 'node:path';
import { requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';
import {
  exportLine,
  quote,
  sendCommand,
  waitForInvocation,
  waitForSsmRegistration,
} from '#shared/ssm.ts';

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

function writeRemoteFile({ name, content }: { name: string; content: string }) {
  return `printf '%s' ${quote(Buffer.from(content).toString('base64'))} | base64 --decode > ${quote(name)}`;
}

const script = [
  "bash -se <<'NIBRUNNER_DEPLOY'",
  'set -euo pipefail',
  'timeout 300 cloud-init status --wait',
  'install -d -m 0700 /opt/nibrun/nibrunner-host',
  'cd /opt/nibrun/nibrunner-host',
  'umask 077',
  writeRemoteFile({ name: 'config.toml', content: configuration }),
  writeRemoteFile({ name: 'on_box_deploy.sh', content: installer }),
  `export ${exportLine({
    NIBRUNNER_VERSION: versions.version,
    NIBRUNNER_INSTALLER_SHA256: versions.installerSha256,
    NIBRUNNER_BINARY_SHA256: versions.binarySha256,
  })}`,
  'bash on_box_deploy.sh',
  'NIBRUNNER_DEPLOY',
].join('\n');

if (!(await waitForSsmRegistration({ instanceId }))) {
  throw new Error(`Nibrunner host ${instanceId} did not register with SSM`);
}

const commandId = await sendCommand({
  instanceIds: [instanceId],
  script,
  comment: `Install nibrunner ${versions.version}`,
});
console.log(`[${instanceId}] SSM command: ${commandId}`);
const invocation = await waitForInvocation({ commandId, instanceId });
console.log(invocation?.StandardOutputContent ?? 'No command output');
if (invocation?.Status !== 'Success') {
  console.error(invocation?.StandardErrorContent ?? 'No command error output');
  throw new Error(`Nibrunner installation ${commandId}: ${invocation?.Status ?? 'Unknown'}`);
}
