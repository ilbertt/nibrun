import * as core from '@actions/core';
import { $ } from 'bun';
import { writeSummary } from '#shared/actions.ts';
import { optionalEnv, requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';

const imageRepository = requiredEnv('IMAGE_REPOSITORY');
const imageUri = `${imageRepository}:${requiredEnv('IMAGE_TAG')}`;
const dockerfile = requiredEnv('DOCKERFILE');
const buildContext = requiredEnv('BUILD_CONTEXT');

// The box is x86_64; a build on an arm runner would push an image it cannot run.
const platform = optionalEnv('PLATFORM') ?? 'linux/amd64';
const sourceLabel = optionalEnv('SOURCE_LABEL') ?? 'https://github.com/ilbertt/nibrun';
const cacheFrom = optionalEnv('CACHE_FROM');
const cacheTo = optionalEnv('CACHE_TO');

core.setOutput('image-uri', imageUri);

async function gitObjectId(path: string): Promise<string> {
  // The root tree is addressed by the empty path; `HEAD:.` is not a revision.
  const revision = path === '.' ? 'HEAD:' : `HEAD:${path}`;
  return (await $`git rev-parse ${revision}`.cwd(repoRoot).text()).trim();
}

async function isPublished(uri: string): Promise<boolean> {
  return (await $`docker manifest inspect ${uri}`.quiet().nothrow()).exitCode === 0;
}

async function skipBuild(message: string): Promise<never> {
  core.info(message);
  await writeSummary(message);
  process.exit(0);
}

// A git object id is already a hash of the tree under it, so every input the
// image is built from collapses into one tag that moves only when the image
// would differ.
const buildInputs = [
  platform,
  sourceLabel,
  await gitObjectId(dockerfile),
  await gitObjectId(buildContext),
];
const contentUri = `${imageRepository}:content-${Bun.SHA256.hash(buildInputs.join('\n'), 'hex')}`;

// Tags are immutable (the commit sha), so a re-run on the same commit has
// nothing to rebuild.
if (await isPublished(imageUri)) {
  await skipBuild(`Image ${imageUri} already exists; skipping build.`);
}

// A commit that leaves this image's inputs alone still needs a tag at its own
// sha, which the registry copies from whichever build last produced them.
if (await isPublished(contentUri)) {
  await $`docker buildx imagetools create --tag ${imageUri} ${contentUri}`;
  await skipBuild(`Image ${contentUri} is unchanged; retagged as ${imageUri} without rebuilding.`);
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
  '--tag',
  contentUri,
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
