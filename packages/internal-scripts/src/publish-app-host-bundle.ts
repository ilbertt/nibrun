import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { $ } from 'bun';
import { aws } from '#shared/aws.ts';
import { requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';

// Kilobytes, deliberately: the units, the ZeroFS config and the deploy scripts.
// The binaries are not in here. They are fetched separately from S3 by version,
// into a versioned path, and skipped entirely if that version is already on disk
// — which is what makes a repeat deploy nearly free and rollback a symlink swap.
// Tarring hundreds of megabytes of unchanged binaries into this would work, and
// would be wrong.
const BUNDLE_DIRECTORIES = ['systemd', 'zerofs', 'caddy'];

// Shell, not TypeScript: these run on the box, which has no Bun. Flattened to the
// bundle root next to the directories above, because the deploy script resolves
// everything relative to itself.
const ON_BOX_SCRIPTS = ['on_box_deploy.sh'];

// Shared with the control plane's bundle — both machine classes have a data
// volume, and what they keep on it arrives as arguments.
const SHARED_ON_BOX_SCRIPTS = ['ensure_data_volume.sh'];

// Also shared: Cloudflare's origin-pull CA is one certificate, and both proxies
// authenticate the same edge against it.
const SHARED_CADDY_FILES = ['cloudflare-origin-pull-ca.pem'];

const deployBucket = requiredEnv('DEPLOY_BUCKET');
const revision = requiredEnv('GITHUB_SHA');

const appHostDir = join(repoRoot, 'infra/app-host');
const bundlePath = join(tmpdir(), 'nibrun-app-host-bundle.tar.gz');

await $`tar czf ${bundlePath} -C ${appHostDir} ${BUNDLE_DIRECTORIES} -C ${join(appHostDir, 'deploy')} ${ON_BOX_SCRIPTS} -C ${join(repoRoot, 'infra/deploy')} ${SHARED_ON_BOX_SCRIPTS} -C ${join(repoRoot, 'infra/caddy')} ${SHARED_CADDY_FILES}`;

const bundleBytes = Bun.file(bundlePath).size;
const url = `s3://${deployBucket}/app-host-bundles/${revision}.tar.gz`;
await aws(['s3', 'cp', bundlePath, url]);

core.setOutput('url', url);
core.info(`${url} (${bundleBytes} bytes)`);
