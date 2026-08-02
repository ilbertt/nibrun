import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { aws } from '#shared/aws.ts';
import { optionalEnv, requiredEnv } from '#shared/env.ts';

const SSM_REGISTRATION_ATTEMPTS = 60;
const DEPLOY_ATTEMPTS = 90;
const POLL_MS = 10_000;
const TERMINAL_STATUSES = new Set(['Success', 'Failed', 'Cancelled', 'TimedOut']);

const bundleUrl = requiredEnv('BUNDLE_URL');
const deployGroup = requiredEnv('DEPLOY_GROUP');

// Every name here is the name the box writes into .env — nothing is rewritten in
// transit. Secrets are absent; the box reads those from SSM itself.
const onBoxEnv: Record<string, string> = {
  API_IMAGE_URI: requiredEnv('API_IMAGE_URI'),
  API_HOSTNAME: requiredEnv('API_HOSTNAME'),
  API_GITHUB_CLIENT_ID: requiredEnv('API_GITHUB_CLIENT_ID'),
  API_S3_BUCKET: requiredEnv('API_S3_BUCKET'),
  API_S3_ENDPOINT: requiredEnv('API_S3_ENDPOINT'),
  PG_BACKUP_IMAGE_URI: requiredEnv('PG_BACKUP_IMAGE_URI'),
  PG_BACKUP_BUCKET: requiredEnv('PG_BACKUP_BUCKET'),
  SSM_SECRET_PREFIX: requiredEnv('SSM_SECRET_PREFIX'),
  DATA_VOLUME_ID: requiredEnv('DATA_VOLUME_ID'),
  AWS_REGION: requiredEnv('AWS_REGION'),
};

// POSIX single quoting: the one form with no metacharacters inside it, so a
// value can never break out of the export line it lands in.
const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const instanceId = (
  await aws([
    'ec2',
    'describe-instances',
    '--filters',
    `Name=tag:DeployGroup,Values=${deployGroup}`,
    'Name=instance-state-name,Values=running',
    '--query',
    'Reservations[0].Instances[0].InstanceId',
    '--output',
    'text',
  ]).text()
).trim();

if (!instanceId || instanceId === 'None') {
  core.setFailed(`No running EC2 instance found for DeployGroup=${deployGroup}`);
  process.exit(1);
}
console.log(`Target instance: ${instanceId}`);

// A freshly-created box isn't registered with SSM yet; wait so send-command lands.
console.log('Waiting for the instance to register with SSM...');
let online = false;
for (let attempt = 0; attempt < SSM_REGISTRATION_ATTEMPTS; attempt++) {
  const ping = (
    await aws([
      'ssm',
      'describe-instance-information',
      '--filters',
      `Key=InstanceIds,Values=${instanceId}`,
      '--query',
      'InstanceInformationList[0].PingStatus',
      '--output',
      'text',
    ])
      .nothrow()
      .quiet()
      .text()
  ).trim();

  if (ping === 'Online') {
    console.log('SSM is Online.');
    online = true;
    break;
  }
  console.log(`  ssm ping: ${ping || 'none'}`);
  await Bun.sleep(POLL_MS);
}

if (!online) {
  core.setFailed(`Instance ${instanceId} did not register with SSM within 10 minutes`);
  process.exit(1);
}

const exportLine = Object.entries(onBoxEnv)
  .map(([name, value]) => `${name}=${quote(value)}`)
  .join(' ');

// The bootstrap-marker wait ensures Docker/Compose/AWS CLI are installed
// (user_data) before we deploy onto a brand-new box. Extract in place (no rm
// -rf) so the compose project keeps its identity, named volumes are not
// orphaned, and the directory Caddy bind-mounts keeps the inode it is holding.
const remoteScript = `
set -euo pipefail
timeout 600 bash -c 'until [ -f /opt/nibrun-bootstrap.done ]; do echo waiting for instance bootstrap; sleep 5; done'
mkdir -p /opt/nibrun
aws s3 cp ${quote(bundleUrl)} /tmp/bundle.tar.gz
tar xzf /tmp/bundle.tar.gz --overwrite -C /opt/nibrun
cd /opt/nibrun
export ${exportLine}
bash on_box_deploy.sh
`;

const parametersPath = join(tmpdir(), 'ssm-params.json');
await Bun.write(parametersPath, JSON.stringify({ commands: [remoteScript] }));

const commandId = (
  await aws([
    'ssm',
    'send-command',
    '--document-name',
    'AWS-RunShellScript',
    '--comment',
    `Deploy ${optionalEnv('GITHUB_SHA') ?? 'manual'}`,
    '--instance-ids',
    instanceId,
    '--parameters',
    `file://${parametersPath}`,
    '--query',
    'Command.CommandId',
    '--output',
    'text',
  ]).text()
).trim();
console.log(`SSM command: ${commandId}`);

async function readInvocation() {
  const result = await aws([
    'ssm',
    'get-command-invocation',
    '--command-id',
    commandId,
    '--instance-id',
    instanceId,
  ])
    .nothrow()
    .quiet();

  if (result.exitCode !== 0) {
    return null;
  }
  return result.json() as {
    Status: string;
    StandardOutputContent: string;
    StandardErrorContent: string;
  };
}

// RunCommand is async, and a full deploy (image pulls + compose up) can run for
// several minutes — longer than the built-in `ssm wait command-executed` allows
// (~100s) — so poll until the invocation reaches a terminal state.
console.log('Waiting for the deploy command to finish (up to ~15m)...');
let invocation = await readInvocation();
for (let attempt = 0; attempt < DEPLOY_ATTEMPTS; attempt++) {
  if (invocation && TERMINAL_STATUSES.has(invocation.Status)) {
    break;
  }
  await Bun.sleep(POLL_MS);
  invocation = await readInvocation();
}

const status = invocation?.Status ?? 'Unknown';
console.log(`Status: ${status}`);
console.log(invocation?.StandardOutputContent ?? '');

if (status !== 'Success') {
  console.error(invocation?.StandardErrorContent ?? '');
  core.setFailed(`Deploy command did not succeed (status: ${status})`);
  process.exit(1);
}
