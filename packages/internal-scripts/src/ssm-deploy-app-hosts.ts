import * as core from '@actions/core';
import { readAppHostVersions } from '#shared/app-host-versions.ts';
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
const deployGroup = requiredEnv('APP_HOST_DEPLOY_GROUP');
const revision = requiredEnv('GITHUB_SHA');

// Each host mounts its own volume, so the one value that differs per host comes
// from a map keyed by instance id rather than a single output.
const dataVolumeIds = JSON.parse(requiredEnv('APP_HOST_DATA_VOLUME_IDS')) as Record<string, string>;

// Keyed by instance id like the volumes above, but what it carries is the host's
// index — which is the point. See the app_host_indexes output for why the storage
// prefix must not be named after the id the map is keyed by.
const hostIndexes = JSON.parse(requiredEnv('APP_HOST_INDEXES')) as Record<string, number>;

const versions = await readAppHostVersions();

// Every name here is the name the box reads, and every version is the one pinned
// in infra/app-host/versions.json — nothing is rewritten in transit, and nothing
// is discovered from S3. Secrets are absent; the box reads those from SSM itself.
const sharedEnv: Record<string, string> = {
  AWS_REGION: requiredEnv('AWS_REGION'),
  SSM_SECRET_PREFIX: requiredEnv('SSM_SECRET_PREFIX'),
  API_HOSTNAME: requiredEnv('API_HOSTNAME'),
  APP_HOST_DOMAIN: requiredEnv('APP_HOST_DOMAIN'),
  WWW_HOSTNAME: requiredEnv('WWW_HOSTNAME'),
  CONTROL_PLANE_INTERNAL_URL: requiredEnv('CONTROL_PLANE_INTERNAL_URL'),
  LOG_INGEST_URL: requiredEnv('LOG_INGEST_URL'),
  VPC_IPV4_CIDR_BLOCK: requiredEnv('VPC_IPV4_CIDR_BLOCK'),
  VPC_IPV6_CIDR_BLOCK: requiredEnv('VPC_IPV6_CIDR_BLOCK'),
  FILESYSTEMS_BUCKET: requiredEnv('FILESYSTEMS_BUCKET'),
  GUEST_IMAGES_BUCKET: requiredEnv('GUEST_IMAGES_BUCKET'),
  ARTIFACTS_BUCKET: requiredEnv('ARTIFACTS_BUCKET'),
  EXPORTS_BUCKET: requiredEnv('EXPORTS_BUCKET'),
  AGENT_VERSION: revision,
  AGENT_URL: requiredEnv('AGENT_URL'),
  ZEROFS_VERSION: versions.zerofs.version,
  ZEROFS_URL: versions.zerofs.url,
  ZEROFS_SHA256: versions.zerofs.sha256,
  ZEROFS_MEMBER: versions.zerofs.member,
  FIRECRACKER_VERSION: versions.firecracker.version,
  FIRECRACKER_URL: versions.firecracker.url,
  FIRECRACKER_SHA256: versions.firecracker.sha256,
  FIRECRACKER_DIRECTORY: versions.firecracker.directory,
  CADDY_VERSION: versions.caddy.version,
  CADDY_URL: versions.caddy.url,
  CADDY_SHA256: versions.caddy.sha256,
  GUEST_IMAGE_VERSION: versions.guestImage ?? '',
};

const instanceIds = await findInstanceIds({ deployGroup });

// Zero hosts is a failure, not a quiet success: an app host that should exist and
// does not is exactly what this deploy is meant to surface.
if (instanceIds.length === 0) {
  core.setFailed(`No running EC2 instance found for DeployGroup=${deployGroup}`);
  process.exit(1);
}
console.log(`Targeting ${instanceIds.length} app host(s): ${instanceIds.join(', ')}`);

// A bootstrap that has already failed never writes its marker, so waiting for one
// is waiting for something that cannot arrive. cloud-init knows, and says so in a
// word — ask it, and turn a quarter of an hour of silence into an answer.
const awaitBootstrap = `
if [ "$(cloud-init status | awk '{print $2}')" = "error" ]; then
  echo "instance bootstrap failed — it will never write its marker:"
  tail -30 /var/log/cloud-init-output.log
  exit 1
fi
timeout 900 bash -c 'until [ -f /opt/nibrun-app-host-bootstrap.done ]; do echo waiting for instance bootstrap; sleep 5; done'`;

const remoteScript = ({ dataVolumeId, hostIndex }: { dataVolumeId: string; hostIndex: number }) => `
set -euo pipefail
${awaitBootstrap}
mkdir -p /opt/nibrun/bundle
aws s3 cp ${quote(bundleUrl)} /tmp/app-host-bundle.tar.gz
tar xzf /tmp/app-host-bundle.tar.gz --overwrite -C /opt/nibrun/bundle
cd /opt/nibrun/bundle
export ${exportLine({ ...sharedEnv, DATA_VOLUME_ID: dataVolumeId, HOST_INDEX: String(hostIndex) })}
bash on_box_deploy.sh
`;

async function deployTo({ instanceId }: { instanceId: string }) {
  const dataVolumeId = dataVolumeIds[instanceId];
  if (!dataVolumeId) {
    return { instanceId, status: 'NoDataVolume', stdout: '', stderr: '' };
  }

  // Compared against undefined rather than tested for truth: host 0 is the first
  // one there is, and the only one there is today.
  const hostIndex = hostIndexes[instanceId];
  if (hostIndex === undefined) {
    return { instanceId, status: 'NoHostIndex', stdout: '', stderr: '' };
  }

  console.log(`[${instanceId}] waiting for SSM registration...`);
  if (!(await waitForSsmRegistration({ instanceId }))) {
    return { instanceId, status: 'NotRegistered', stdout: '', stderr: '' };
  }

  const commandId = await sendCommand({
    instanceIds: [instanceId],
    script: remoteScript({ dataVolumeId, hostIndex }),
    comment: `Deploy ${optionalEnv('GITHUB_SHA') ?? 'manual'}`,
  });
  console.log(`[${instanceId}] SSM command: ${commandId}`);

  const invocation = await waitForInvocation({ commandId, instanceId });
  return {
    instanceId,
    status: invocation?.Status ?? 'Unknown',
    stdout: invocation?.StandardOutputContent ?? '',
    stderr: invocation?.StandardErrorContent ?? '',
  };
}

// Concurrently, but every result is collected before anything is decided: a
// partial rollout has to fail the deploy rather than be reported as success.
const results = await Promise.all(instanceIds.map((instanceId) => deployTo({ instanceId })));

for (const result of results) {
  console.log(`\n===== ${result.instanceId}: ${result.status} =====`);
  console.log(result.stdout);
  if (result.status !== 'Success') {
    console.error(result.stderr);
  }
}

const failed = results.filter((result) => result.status !== 'Success');
if (failed.length > 0) {
  core.setFailed(
    `Deploy failed on ${failed.length}/${results.length} app host(s): ${failed
      .map((result) => `${result.instanceId} (${result.status})`)
      .join(', ')}`,
  );
  process.exit(1);
}

console.log(`\nDeployed to all ${results.length} app host(s).`);
