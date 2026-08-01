import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { requiredEnv } from '#shared/env.ts';

const ATTEMPTS = 12;
const RETRY_MS = 10_000;

const images = Bun.argv.slice(2);
if (images.length === 0) {
  images.push(requiredEnv('API_IMAGE_URI'), requiredEnv('PG_BACKUP_IMAGE_URI'));
}

// An empty docker config forces the anonymous pull the box will attempt, even
// though this runner is logged in to the registry.
const dockerConfig = await mkdtemp(join(tmpdir(), 'nibrun-docker-'));

async function isAnonymouslyPullable(image: string): Promise<boolean> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { exitCode } = await $`docker manifest inspect ${image}`
      .env({ ...Bun.env, DOCKER_CONFIG: dockerConfig })
      .quiet()
      .nothrow();
    if (exitCode === 0) {
      return true;
    }
    console.log(`Waiting for anonymous pull access: ${image} (${attempt}/${ATTEMPTS})`);
    if (attempt < ATTEMPTS) {
      await Bun.sleep(RETRY_MS);
    }
  }
  return false;
}

try {
  const failed: string[] = [];

  for (const image of images) {
    if (await isAnonymouslyPullable(image)) {
      console.log(`Public pull check passed: ${image}`);
    } else {
      failed.push(image);
      console.log(
        `::error title=GHCR package is not public::${image} cannot be pulled anonymously. Make the GHCR package public, then rerun this workflow.`,
      );
    }
  }

  if (failed.length > 0) {
    console.error(
      '\nnibrun release images must be public because the box pulls them without registry credentials.',
    );
    console.error(
      'Set each nibrun container package to Public under https://github.com/ilbertt?tab=packages',
    );
    process.exit(1);
  }
} finally {
  await rm(dockerConfig, { recursive: true, force: true });
}
