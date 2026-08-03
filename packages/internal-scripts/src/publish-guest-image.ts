import { join } from 'node:path';
import * as core from '@actions/core';
import { $ } from 'bun';
import { writeSummary } from '#shared/actions.ts';
import { aws } from '#shared/aws.ts';
import { requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';

// Publishing is not adopting. This uploads an image under its own version and
// stops; a host only runs it once a separate, reviewable commit edits `guestImage`
// in infra/app-host/versions.json. That split is what keeps the fleet's kernel a
// deliberate input rather than whatever the last build produced.

type Manifest = {
  version: string;
  artifacts: { name: string; bytes: number; sha256: string }[];
  inputs: { init_is_stub: boolean };
};

const guestImageDir = join(repoRoot, 'infra/guest-image');
const distDir = join(guestImageDir, 'dist');

const bucket = requiredEnv('GUEST_IMAGES_BUCKET');

// The version is a digest of every input the build reads, so "has this already
// been published" and "have the inputs changed" are the same question — which is
// what stops the image being rebuilt on every push.
const version = (await $`bash ${join(guestImageDir, 'version.sh')}`.text()).trim();
core.info(`Guest image version: ${version}`);
core.setOutput('version', version);

const published = await aws([
  's3api',
  'head-object',
  '--bucket',
  bucket,
  '--key',
  `${version}/manifest.json`,
])
  .nothrow()
  .quiet();

if (published.exitCode === 0) {
  core.info('Already published — inputs unchanged, nothing to build.');
  process.exit(0);
}

core.info('Not published yet — building.');
await $`bash ${join(guestImageDir, 'build.sh')}`.cwd(guestImageDir);

const manifest = (await Bun.file(join(distDir, 'manifest.json')).json()) as Manifest;

if (manifest.inputs.init_is_stub) {
  core.setFailed('Refusing to publish an image built with the stub /init.');
  process.exit(1);
}

if (manifest.version !== version) {
  core.setFailed(
    `Built ${manifest.version} but expected ${version} — the build is not reproducible.`,
  );
  process.exit(1);
}

// The box verifies what it downloaded, and it has no jq — so the digests the
// manifest already carries are also written in the format sha256sum reads.
const checksums = manifest.artifacts
  .map((artifact) => `${artifact.sha256}  ${artifact.name}`)
  .join('\n');
await Bun.write(join(distDir, 'SHA256SUMS'), `${checksums}\n`);

await aws(['s3', 'cp', '--recursive', distDir, `s3://${bucket}/${version}/`]);

core.info(`Published s3://${bucket}/${version}/`);

// Publishing is not adopting, and adopting is a human editing a pin. That person
// should not have to dig the version out of a build log to find what to paste.
await writeSummary(
  [
    '## Guest image published',
    '',
    `\`${version}\``,
    '',
    'No host runs it yet. To adopt it, set `guestImage` to that value in',
    '`infra/app-host/versions.json` and open a pull request — that commit is the',
    'reviewable record of the fleet changing kernel.',
  ].join('\n'),
);
