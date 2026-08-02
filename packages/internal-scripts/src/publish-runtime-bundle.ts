import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { $ } from 'bun';
import { aws } from '#shared/aws.ts';
import { requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.prod.yml'];
// Shell, not TypeScript: these run on the box, which has no Bun.
const ON_BOX_SCRIPTS = ['on_box_deploy.sh', 'ensure_data_volume.sh'];
// The proxy's whole configuration. The CA is Cloudflare's public origin-pull
// root, so it ships here rather than through SSM with the certificate it
// verifies.
const CADDY_FILES = ['Caddyfile', 'cloudflare-origin-pull-ca.pem'];

const deployBucket = requiredEnv('DEPLOY_BUCKET');
const revision = requiredEnv('GITHUB_SHA');

for (const composeFile of COMPOSE_FILES) {
  if (!(await Bun.file(join(repoRoot, composeFile)).exists())) {
    core.setFailed(`Missing ${composeFile} at the repo root — the on-box deploy runs both.`);
    process.exit(1);
  }
}

const bundlePath = join(tmpdir(), 'nibrun-bundle.tar.gz');

await $`tar czf ${bundlePath} -C ${repoRoot} ${COMPOSE_FILES} -C ${join(repoRoot, 'infra/deploy')} ${ON_BOX_SCRIPTS} -C ${join(repoRoot, 'infra/caddy')} ${CADDY_FILES}`;

const url = `s3://${deployBucket}/bundles/${revision}.tar.gz`;
await aws(['s3', 'cp', bundlePath, url]);

core.setOutput('url', url);
core.info(url);
