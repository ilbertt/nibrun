import * as core from '@actions/core';
import { readAppHostVersions, versionsPath } from '#shared/app-host-versions.ts';
import { requiredEnv } from '#shared/env.ts';

// Only edits the file. The commit it lands in is a pull request, so the kernel
// every host boots still changes on a merge someone approved.

const version = requiredEnv('GUEST_IMAGE_VERSION');
const versions = await readAppHostVersions();
const changed = versions.guestImage !== version;

core.setOutput('changed', String(changed));

if (!changed) {
  core.info(`Already pinned to ${version}.`);
  process.exit(0);
}

await Bun.write(versionsPath, `${JSON.stringify({ ...versions, guestImage: version }, null, 2)}\n`);

core.info(`${versions.guestImage} → ${version}`);
