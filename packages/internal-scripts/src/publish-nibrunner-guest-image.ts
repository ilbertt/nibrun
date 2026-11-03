import { join } from 'node:path';
import * as core from '@actions/core';
import { $ } from 'bun';
import { requireMainWorkflow } from '#shared/actions.ts';
import { aws } from '#shared/aws.ts';
import { requiredEnv } from '#shared/env.ts';
import {
  digestFile,
  type GuestImageManifest,
  imageOutputDirectory,
} from '#shared/nibrunner-guest-image.ts';

requireMainWorkflow();

const manifest = (await Bun.file(
  join(imageOutputDirectory, 'manifest.json'),
).json()) as GuestImageManifest;
const archive = join(imageOutputDirectory, 'image.tar.gz');
await $`tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -czf ${archive} -C ${imageOutputDirectory} vmlinux rootfs.ext4 manifest.json checksums.txt`;
const sha256 = await digestFile(archive);
const bucket = requiredEnv('DEPLOY_BUCKET');
const key = `nibrunner-guest/${manifest.version}/image.tar.gz`;
const held = await aws(['s3api', 'head-object', '--bucket', bucket, '--key', key])
  .quiet()
  .nothrow();
if (held.exitCode === 0) {
  const metadata = held.json();
  if (metadata.Metadata?.sha256 !== sha256) {
    throw new Error(`Guest image ${manifest.version} was already published with different bytes.`);
  }
} else {
  await aws([
    's3api',
    'put-object',
    '--bucket',
    bucket,
    '--key',
    key,
    '--body',
    archive,
    '--metadata',
    `sha256=${sha256}`,
    '--if-none-match',
    '*',
  ]);
}
core.setOutput('version', manifest.version);
core.setOutput('url', `s3://${bucket}/${key}`);
core.setOutput('sha256', sha256);
