import { join } from 'node:path';
import { $ } from 'bun';
import { repoRoot } from '#shared/paths.ts';
import pins from '../../../../infra/nibrunner-host/versions.json' with { type: 'json' };

const DOWNLOAD_TIMEOUT_MS = 300_000;
const VERSION_HASH_LENGTH = 12;

export const imageSourceDirectory = join(repoRoot, 'infra/nibrunner-guest-image');
export const imageOutputDirectory = join(imageSourceDirectory, 'dist');

export type GuestImageManifest = {
  version: string;
  artifacts: { name: string; bytes: number; sha256: string }[];
  inputs: {
    source_date_epoch: number;
    init_sha256: string;
    [key: string]: unknown;
  };
};

export async function digestFile(path: string) {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest('hex');
}

async function download({
  name,
  destination,
  sha256,
}: {
  name: string;
  destination: string;
  sha256: string;
}) {
  const path = join(destination, name);
  if (await Bun.file(path).exists()) {
    if ((await digestFile(path)) === sha256) {
      return;
    }
  }
  const url = `https://github.com/ilbertt/nibrunner/releases/download/${pins.version}/${name}`;
  console.info(`Downloading pinned nibrunner ${name}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Cannot download the stock guest image: ${response.status} ${url}`);
  }
  await Bun.write(path, response);
  if ((await digestFile(path)) !== sha256) {
    throw new Error(`Stock guest image checksum mismatch: ${name}`);
  }
}

async function stockImage(directory: string) {
  await download({
    name: 'manifest.json',
    destination: directory,
    sha256: pins.guestManifestSha256,
  });
  const manifest = (await Bun.file(join(directory, 'manifest.json')).json()) as GuestImageManifest;
  for (const name of ['vmlinux', 'rootfs.ext4']) {
    const artifact = manifest.artifacts.find((candidate) => candidate.name === name);
    if (artifact === undefined) {
      throw new Error(`Stock guest manifest does not describe ${name}`);
    }
    await download({ name, destination: directory, sha256: artifact.sha256 });
  }
  return manifest;
}

export async function buildNibrunnerGuestImage() {
  const stockDirectory = join(imageOutputDirectory, 'stock');
  await $`mkdir -p ${stockDirectory}`;
  const stock = await stockImage(stockDirectory);
  const runtimeDirectory = join(repoRoot, 'apps/runtime');
  const variables = await Bun.file(join(runtimeDirectory, 'versions.env')).text();
  const buildArguments = Array.from(variables.matchAll(/^([A-Z][A-Z0-9_]+)=(.+)$/gm)).flatMap(
    (match) => ['--build-arg', `${match[1]}=${match[2]}`],
  );
  const toolchain = 'nibrun-guest-runtime:build';
  await $`docker build --platform=linux/amd64 --target=toolchain --tag ${toolchain} ${buildArguments} ${runtimeDirectory}`;
  await $`docker build --platform=linux/amd64 --build-arg RUNTIME_TOOLCHAIN=${toolchain} --build-context stock=${stockDirectory} --target=image --output type=local,dest=${imageOutputDirectory} ${imageSourceDirectory}`;

  const initSha256 = await digestFile(join(imageOutputDirectory, 'image-init'));
  const recipe = await digestFile(join(imageSourceDirectory, 'patch-image.sh'));
  const dockerfile = await digestFile(join(imageSourceDirectory, 'Dockerfile'));
  const builder = await digestFile(import.meta.filename);
  const artifacts = [];
  for (const name of ['vmlinux', 'rootfs.ext4']) {
    if (name === 'vmlinux') {
      await Bun.write(join(imageOutputDirectory, name), Bun.file(join(stockDirectory, name)));
    }
    const artifactPath = join(imageOutputDirectory, name);
    const file = Bun.file(artifactPath);
    artifacts.push({ name, bytes: file.size, sha256: await digestFile(artifactPath) });
  }
  const identity = new Bun.CryptoHasher('sha256')
    .update(
      JSON.stringify({
        upstreamVersion: pins.version,
        upstream: pins.guestManifestSha256,
        initSha256,
        recipe,
        dockerfile,
        builder,
        artifacts,
      }),
    )
    .digest('hex')
    .slice(0, VERSION_HASH_LENGTH);
  const manifest: GuestImageManifest = {
    version: `${stock.version}-nibrun-${identity}`,
    inputs: {
      ...stock.inputs,
      upstream_version: pins.version,
      upstream_manifest_sha256: pins.guestManifestSha256,
      stock_init_sha256: stock.inputs.init_sha256,
      init_sha256: initSha256,
      recipe_sha256: recipe,
      dockerfile_sha256: dockerfile,
      builder_sha256: builder,
    },
    artifacts,
  };
  await Bun.write(
    join(imageOutputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const manifestSha256 = await digestFile(join(imageOutputDirectory, 'manifest.json'));
  await Bun.write(
    join(imageOutputDirectory, 'checksums.txt'),
    `${[...artifacts, { name: 'manifest.json', sha256: manifestSha256 }].map(({ name, sha256 }) => `${sha256}  ${name}`).join('\n')}\n`,
  );
  return manifest;
}
