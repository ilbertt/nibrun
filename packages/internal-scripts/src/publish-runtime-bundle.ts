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
const METRICS_DIRECTORIES = ['infra/grafana', 'infra/prometheus'];

const deployBucket = requiredEnv('DEPLOY_BUCKET');
const revision = requiredEnv('GITHUB_SHA');

for (const composeFile of COMPOSE_FILES) {
  if (!(await Bun.file(join(repoRoot, composeFile)).exists())) {
    core.setFailed(`Missing ${composeFile} at the repo root — the on-box deploy runs both.`);
    process.exit(1);
  }
}

const bundlePath = join(tmpdir(), 'nibrun-bundle.tar.gz');
const seedScripts = ['seed-umami', 'seed-grafana'];
for (const name of seedScripts) {
  const build = await Bun.build({
    entrypoints: [join(repoRoot, `packages/internal-scripts/src/${name}.ts`)],
    target: 'node',
    outdir: tmpdir(),
    naming: `${name}.mjs`,
  });
  if (!build.success) {
    throw new AggregateError(build.logs, `Unable to bundle ${name}`);
  }
}
const bundledScripts = seedScripts.map(function outputFile(name) {
  return `${name}.mjs`;
});

await $`tar czf ${bundlePath} -C ${repoRoot} ${COMPOSE_FILES} ${METRICS_DIRECTORIES} -C ${join(repoRoot, 'infra/deploy')} ${ON_BOX_SCRIPTS} -C ${join(repoRoot, 'infra')} caddy -C ${tmpdir()} ${bundledScripts}`;

const url = `s3://${deployBucket}/bundles/${revision}.tar.gz`;
await aws(['s3', 'cp', bundlePath, url]);

core.setOutput('url', url);
core.info(url);
