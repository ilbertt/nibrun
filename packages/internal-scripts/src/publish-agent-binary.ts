import { join } from 'node:path';
import * as core from '@actions/core';
import { aws } from '#shared/aws.ts';
import { requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';

// Published under its git SHA, because every push ships a new agent — that is the
// point of it being the component that updates most often. It lands in the deploy
// bucket rather than artifacts: it is a deploy artifact, and the deploy role must
// never hold write access to the bucket holding tenant binaries.
const binaryPath = join(repoRoot, 'apps/agent/dist/nibrun-agent');

const deployBucket = requiredEnv('DEPLOY_BUCKET');
const revision = requiredEnv('GITHUB_SHA');

if (!(await Bun.file(binaryPath).exists())) {
  core.setFailed(`Missing ${binaryPath} — run the agent build before publishing it.`);
  process.exit(1);
}

const url = `s3://${deployBucket}/agent/${revision}/nibrun-agent`;
await aws(['s3', 'cp', binaryPath, url]);

core.setOutput('url', url);
core.setOutput('version', revision);
core.info(`${url} (${Bun.file(binaryPath).size} bytes)`);
