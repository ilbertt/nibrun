import * as core from '@actions/core';
import { $ } from 'bun';
import { writeSummary } from '#shared/actions.ts';
import { optionalEnv, requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';

const imageUri = `${requiredEnv('IMAGE_REPOSITORY')}:${requiredEnv('IMAGE_TAG')}`;
const dockerfile = requiredEnv('DOCKERFILE');
const buildContext = requiredEnv('BUILD_CONTEXT');

// The box is x86_64; a build on an arm runner would push an image it cannot run.
const platform = optionalEnv('PLATFORM') ?? 'linux/amd64';
const sourceLabel = optionalEnv('SOURCE_LABEL') ?? 'https://github.com/ilbertt/nibrun';
const cacheFrom = optionalEnv('CACHE_FROM');
const cacheTo = optionalEnv('CACHE_TO');

core.setOutput('image-uri', imageUri);

// Tags are immutable (the commit sha), so a re-run on the same commit has
// nothing to rebuild.
const existing = await $`docker manifest inspect ${imageUri}`.quiet().nothrow();
if (existing.exitCode === 0) {
  const message = `Image ${imageUri} already exists; skipping build.`;
  core.info(message);
  await writeSummary(message);
  process.exit(0);
}

const argv = [
  'docker',
  'buildx',
  'build',
  '--platform',
  platform,
  '--push',
  '--tag',
  imageUri,
  '--label',
  `org.opencontainers.image.source=${sourceLabel}`,
  '--file',
  dockerfile,
  ...(cacheFrom ? ['--cache-from', cacheFrom] : []),
  ...(cacheTo ? ['--cache-to', cacheTo] : []),
  buildContext,
];

// Echoed so a failing CI build can be reproduced by copy-paste.
core.info(`$ ${argv.map((arg) => $.escape(arg)).join(' ')}`);
await $`${argv}`.cwd(repoRoot);
