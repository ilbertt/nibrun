import * as core from '@actions/core';
import { optionalEnv, requiredEnv } from '#shared/env.ts';
import {
  exportLine,
  findInstanceIds,
  quote,
  sendCommand,
  waitForInvocation,
  waitForSsmRegistration,
} from '#shared/ssm.ts';

const bundleUrl = requiredEnv('BUNDLE_URL');
const deployGroup = requiredEnv('DEPLOY_GROUP');

// Every name here is the name the box writes into .env — nothing is rewritten in
// transit. Secrets are absent; the box reads those from SSM itself.
const onBoxEnv: Record<string, string> = {
  API_IMAGE_URI: requiredEnv('API_IMAGE_URI'),
  API_HOSTNAME: requiredEnv('API_HOSTNAME'),
  DOZZLE_HOSTNAME: requiredEnv('DOZZLE_HOSTNAME'),
  VICTORIALOGS_HOSTNAME: requiredEnv('VICTORIALOGS_HOSTNAME'),
  INTERNAL_PORT: requiredEnv('INTERNAL_PORT'),
  LOG_INGEST_PORT: requiredEnv('LOG_INGEST_PORT'),
  API_GITHUB_CLIENT_ID: requiredEnv('API_GITHUB_CLIENT_ID'),
  ARTIFACTS_BUCKET: requiredEnv('ARTIFACTS_BUCKET'),
  EXPORTS_BUCKET: requiredEnv('EXPORTS_BUCKET'),
  EXPORT_RETENTION_DAYS: requiredEnv('EXPORT_RETENTION_DAYS'),
  API_S3_ENDPOINT: requiredEnv('API_S3_ENDPOINT'),
  PG_BACKUP_IMAGE_URI: requiredEnv('PG_BACKUP_IMAGE_URI'),
  PG_BACKUP_BUCKET: requiredEnv('PG_BACKUP_BUCKET'),
  SSM_SECRET_PREFIX: requiredEnv('SSM_SECRET_PREFIX'),
  DATA_VOLUME_ID: requiredEnv('DATA_VOLUME_ID'),
  AWS_REGION: requiredEnv('AWS_REGION'),
  APP_HOST_DOMAIN: requiredEnv('APP_HOST_DOMAIN'),
};

const [instanceId] = await findInstanceIds({ deployGroup });

if (!instanceId) {
  core.setFailed(`No running EC2 instance found for DeployGroup=${deployGroup}`);
  process.exit(1);
}
console.log(`Target instance: ${instanceId}`);

console.log('Waiting for the instance to register with SSM...');
if (!(await waitForSsmRegistration({ instanceId }))) {
  core.setFailed(`Instance ${instanceId} did not register with SSM within 10 minutes`);
  process.exit(1);
}
console.log('SSM is Online.');

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
export ${exportLine(onBoxEnv)}
bash on_box_deploy.sh
`;

const commandId = await sendCommand({
  instanceIds: [instanceId],
  script: remoteScript,
  comment: `Deploy ${optionalEnv('GITHUB_SHA') ?? 'manual'}`,
});
console.log(`SSM command: ${commandId}`);

console.log('Waiting for the deploy command to finish (up to ~15m)...');
const invocation = await waitForInvocation({ commandId, instanceId });

const status = invocation?.Status ?? 'Unknown';
console.log(`Status: ${status}`);
console.log(invocation?.StandardOutputContent ?? '');

if (status !== 'Success') {
  console.error(invocation?.StandardErrorContent ?? '');
  core.setFailed(`Deploy command did not succeed (status: ${status})`);
  process.exit(1);
}
