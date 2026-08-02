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
// Ships as a directory because that is how it is mounted: the proxy reads
// through the directory, so replacing a file in it cannot leave the running
// container on the old inode. Holds the Caddyfile and Cloudflare's public
// origin-pull CA — the certificate that CA verifies comes from SSM instead.
const CADDY_DIR = 'caddy';

const deployBucket = requiredEnv('DEPLOY_BUCKET');
const revision = requiredEnv('GITHUB_SHA');

for (const composeFile of COMPOSE_FILES) {
  if (!(await Bun.file(join(repoRoot, composeFile)).exists())) {
    core.setFailed(`Missing ${composeFile} at the repo root — the on-box deploy runs both.`);
    process.exit(1);
  }
}

const bundlePath = join(tmpdir(), 'nibrun-bundle.tar.gz');

await $`tar czf ${bundlePath} -C ${repoRoot} ${COMPOSE_FILES} -C ${join(repoRoot, 'infra/deploy')} ${ON_BOX_SCRIPTS} -C ${join(repoRoot, 'infra')} ${CADDY_DIR}`;

const url = `s3://${deployBucket}/bundles/${revision}.tar.gz`;
await aws(['s3', 'cp', bundlePath, url]);

core.setOutput('url', url);
core.info(url);
