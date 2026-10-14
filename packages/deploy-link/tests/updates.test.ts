import { expect, test } from 'bun:test';
import { DEPLOY_PRESETS, type DeployPreset } from '#presets.ts';
import { findUpdate, type PresetUpdate, type Release } from '#scripts/updates/releases.ts';
import { updatePresetSource } from '#scripts/updates/source.ts';

const SHA256_HEX_LENGTH = 64;
const ARCHIVE_PRESET = {
  ...DEPLOY_PRESETS.pocketbase,
  projectUrl: 'https://github.com/example/studio',
  version: '1.0.0',
  deployLink: {
    binary: 'https://github.com/example/runtime/releases/download/v2.0.0/runtime.zip',
    sha256: 'b'.repeat(SHA256_HEX_LENGTH),
    'initial-data':
      'https://github.com/example/studio/releases/download/1.0.0/studio-1.0.0-linux-x64.tar.gz',
  },
} satisfies DeployPreset;

function releaseRequest(options: { preset: DeployPreset; version: string; assetName: string }) {
  const { preset, version, assetName } = options;
  const download = new URL(preset.deployLink['initial-data'] ?? preset.deployLink.binary!);
  const [, owner, name] = download.pathname.split('/');
  const repository = `${owner}/${name}`;
  const endpoint = `https://api.github.com/repos/${repository}/releases`;
  const binary = `https://github.com/${repository}/releases/download/${version}/${assetName}`;
  const checksum = 'a'.repeat(SHA256_HEX_LENGTH);
  const latest: Release = {
    tag_name: version,
    draft: false,
    prerelease: false,
    published_at: '2026-10-15T00:00:00Z',
    html_url: `https://github.com/${repository}/releases/tag/${version}`,
    assets: [{ name: assetName, browser_download_url: binary, digest: `sha256:${checksum}` }],
  };
  const current = { ...latest, tag_name: preset.version, published_at: '2026-10-14T00:00:00Z' };
  const requests: string[] = [];
  function request(url: string): Promise<Response> {
    requests.push(url);
    if (url === `${endpoint}/latest`) {
      return Promise.resolve(Response.json(latest));
    }
    if (url === `${endpoint}/tags/${preset.version}`) {
      return Promise.resolve(Response.json(current));
    }
    throw new Error(`Unexpected release request: ${url}`);
  }
  return { request, requests, binary, checksum, endpoint };
}

async function writtenUpdate(options: { preset: DeployPreset; update: PresetUpdate }) {
  const { preset, update } = options;
  const presets = {
    [update.slug]: { version: preset.version, deployLink: preset.deployLink },
    unchanged: { version: preset.version, deployLink: preset.deployLink },
  };
  const written = await updatePresetSource({
    source: `export const DEPLOY_PRESETS = ${JSON.stringify(presets)};`,
    updates: [update],
  });
  const { version, ...pins } = update.next;
  const expected = {
    ...presets,
    [update.slug]: { version, deployLink: { ...preset.deployLink, ...pins } },
  };
  expect(written).toBe(`export const DEPLOY_PRESETS = ${JSON.stringify(expected)};`);
}

test('an application archive updates without changing its pinned runtime', async () => {
  const preset = ARCHIVE_PRESET;
  const release = releaseRequest({
    preset,
    version: '99.0.0',
    assetName: 'studio-99.0.0-linux-x64.tar.gz',
  });
  const update = await findUpdate({ slug: 'studio', preset, request: release.request });

  expect(update).toBeDefined();
  expect(update!.next).toEqual({
    version: '99.0.0',
    binary: preset.deployLink.binary,
    sha256: preset.deployLink.sha256,
    'initial-data': release.binary,
  });
  expect(release.requests).toEqual([
    `${release.endpoint}/latest`,
    `${release.endpoint}/tags/${preset.version}`,
  ]);
  await writtenUpdate({ preset, update: update! });
});

test('binary-only presets still update their executable and checksum', async () => {
  const preset = DEPLOY_PRESETS.pocketbase;
  const release = releaseRequest({
    preset,
    version: 'v99.0.0',
    assetName: 'pocketbase_99.0.0_linux_amd64.zip',
  });
  const update = await findUpdate({ slug: 'pocketbase', preset, request: release.request });

  expect(update).toBeDefined();
  expect(update!.next).toEqual({
    version: 'v99.0.0',
    binary: release.binary,
    sha256: release.checksum,
    'initial-data': undefined,
  });
  await writtenUpdate({ preset, update: update! });
});

test('an unchanged application archive does not follow the runtime release', async () => {
  const preset = ARCHIVE_PRESET;
  const release = releaseRequest({
    preset,
    version: preset.version,
    assetName: 'unused.tar.gz',
  });
  expect(await findUpdate({ slug: 'studio', preset, request: release.request })).toBeUndefined();
  expect(release.requests).toEqual([`${release.endpoint}/latest`]);
});

test('a missing application archive refuses an update', async () => {
  const preset = ARCHIVE_PRESET;
  const release = releaseRequest({ preset, version: '99.0.0', assetName: 'source.zip' });
  await expect(findUpdate({ slug: 'studio', preset, request: release.request })).rejects.toThrow(
    'has no asset named studio-99.0.0-linux-x64.tar.gz',
  );
});
