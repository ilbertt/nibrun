import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { DEPLOY_PRESETS } from '#presets.ts';
import { presetUpdateProposal } from '#scripts/updates/proposal.ts';
import {
  findUpdate,
  type PresetUpdate,
  type Release,
  updatedAssetName,
} from '#scripts/updates/releases.ts';
import { updatePresetSource } from '#scripts/updates/source.ts';

const preset = DEPLOY_PRESETS.pocketbase;
const currentUrl = new URL(preset.deployLink.binary);
const releaseEndpoint = 'https://api.github.com/repos/pocketbase/pocketbase/releases';
const nextVersion = 'v0.40.4';
const nextBinary = preset.deployLink.binary.replaceAll('0.40.3', '0.40.4');
const SHA256_HEX_LENGTH = 64;
const nextChecksum = 'a'.repeat(SHA256_HEX_LENGTH);

function release(overrides: Partial<Release>): Release {
  return {
    tag_name: nextVersion,
    draft: false,
    prerelease: false,
    published_at: '2026-10-08T00:00:00Z',
    html_url: 'https://github.com/pocketbase/pocketbase/releases/tag/v0.40.4',
    assets: [
      {
        name: 'pocketbase_0.40.4_linux_amd64.zip',
        browser_download_url: nextBinary,
        digest: `sha256:${nextChecksum}`,
      },
    ],
    ...overrides,
  };
}

function requests(options: {
  latest: Release;
  current: Release;
  urls: string[];
  download: string;
}) {
  return function request(url: string): Promise<Response> {
    options.urls.push(url);
    if (url === `${releaseEndpoint}/latest`) {
      return Promise.resolve(Response.json(options.latest));
    }
    if (url === `${releaseEndpoint}/tags/${preset.version}`) {
      return Promise.resolve(Response.json(options.current));
    }
    if (url === nextBinary) {
      return Promise.resolve(new Response(options.download));
    }
    throw new Error(`Unexpected request: ${url}`);
  };
}

function currentRelease(): Release {
  return release({ tag_name: preset.version, published_at: '2026-10-01T00:00:00Z' });
}

test('a newer release updates the version, matching asset and published checksum', async () => {
  const urls: string[] = [];
  const update = await findUpdate({
    slug: 'pocketbase',
    preset,
    request: requests({ latest: release({}), current: currentRelease(), urls, download: '' }),
  });
  expect(update?.next).toEqual({ version: nextVersion, binary: nextBinary, sha256: nextChecksum });
  expect(urls).toEqual([`${releaseEndpoint}/latest`, `${releaseEndpoint}/tags/${preset.version}`]);
});

test('an unchanged release performs no asset download', async () => {
  const urls: string[] = [];
  expect(
    await findUpdate({
      slug: 'pocketbase',
      preset,
      request: requests({
        latest: currentRelease(),
        current: currentRelease(),
        urls,
        download: '',
      }),
    }),
  ).toBeUndefined();
  expect(urls).toEqual([`${releaseEndpoint}/latest`]);
});

test('an older latest release cannot downgrade a pin', async () => {
  expect(
    await findUpdate({
      slug: 'pocketbase',
      preset,
      request: requests({
        latest: release({ published_at: '2026-09-01T00:00:00Z' }),
        current: currentRelease(),
        urls: [],
        download: '',
      }),
    }),
  ).toBeUndefined();
});

test.each([{ draft: true }, { prerelease: true }])(
  'unpublished and prerelease candidates are ignored: %j',
  async (flags) => {
    expect(
      await findUpdate({
        slug: 'pocketbase',
        preset,
        request: requests({
          latest: release(flags),
          current: currentRelease(),
          urls: [],
          download: '',
        }),
      }),
    ).toBeUndefined();
  },
);

test('an asset without a digest is downloaded and hashed without being executed', async () => {
  const download = 'downloaded archive bytes';
  const latest = release({});
  latest.assets[0]!.digest = null;
  const update = await findUpdate({
    slug: 'pocketbase',
    preset,
    request: requests({ latest, current: currentRelease(), urls: [], download }),
  });
  expect(update?.next.sha256).toBe(createHash('sha256').update(download).digest('hex'));
});

test('a renamed or missing platform asset requires attention', async () => {
  await expect(
    findUpdate({
      slug: 'pocketbase',
      preset,
      request: requests({
        latest: release({ assets: [] }),
        current: currentRelease(),
        urls: [],
        download: '',
      }),
    }),
  ).rejects.toThrow('has no asset named');
});

test('rolling presets already follow updates and are left unpinned', async () => {
  const urls: string[] = [];
  expect(
    await findUpdate({
      slug: 'context-use',
      preset: DEPLOY_PRESETS['context-use'],
      request: requests({ latest: release({}), current: currentRelease(), urls, download: '' }),
    }),
  ).toBeUndefined();
  expect(urls).toEqual([]);
});

test('release lookup follows the binary fork rather than the project homepage', async () => {
  const urls: string[] = [];
  function request(url: string) {
    urls.push(url);
    return Promise.resolve(Response.json(release({ tag_name: DEPLOY_PRESETS.gitea.version })));
  }
  await findUpdate({ slug: 'gitea', preset: DEPLOY_PRESETS.gitea, request });
  expect(urls).toEqual(['https://api.github.com/repos/ilbertt/gitea/releases/latest']);
});

test.each([
  { name: 'pocketbase_0.40.3_linux_amd64.zip', expected: 'pocketbase_0.40.4_linux_amd64.zip' },
  {
    name: 'picoshare-v0.40.3-linux-amd64.tar.gz',
    expected: 'picoshare-v0.40.4-linux-amd64.tar.gz',
  },
  { name: 'linux-amd64-filebrowser.tar.gz', expected: 'linux-amd64-filebrowser.tar.gz' },
])('asset name retains its platform and archive format: %j', ({ name, expected }) => {
  expect(
    updatedAssetName({
      name,
      previous: {
        version: preset.version,
        binary: currentUrl.href,
        sha256: preset.deployLink.sha256,
      },
      latest: { tag_name: nextVersion },
    }),
  ).toBe(expected);
});

test('Drizzle updates come from its published Linux x64 download and are hashed', async () => {
  const drizzle = DEPLOY_PRESETS['drizzle-gateway'];
  const binary = drizzle.deployLink.binary.replace('1.6.0', '1.7.0');
  function request(url: string) {
    return Promise.resolve(
      new Response(
        url === `${drizzle.projectUrl}/docs/binary`
          ? `<span>${binary}</span>\n${binary}\n`
          : 'drizzle binary',
      ),
    );
  }
  const update = await findUpdate({ slug: 'drizzle-gateway', preset: drizzle, request });
  expect(update?.next).toEqual({
    version: 'v1.7.0',
    binary,
    sha256: createHash('sha256').update('drizzle binary').digest('hex'),
  });
});

test('a missing Drizzle download is reported instead of treated as up to date', async () => {
  function request() {
    return Promise.resolve(new Response('<html>No download</html>'));
  }
  await expect(
    findUpdate({ slug: 'drizzle-gateway', preset: DEPLOY_PRESETS['drizzle-gateway'], request }),
  ).rejects.toThrow('Expected one current');
});

const source = `export const DEPLOY_PRESETS = {
  "pocketbase": {
    version: "v0.40.3",
    subtitle: "v0.40.3",
    deployLink: {
      binary: "${preset.deployLink.binary}",
      sha256: "${preset.deployLink.sha256}",
      env: ["VERSION=v0.40.3"],
    },
  },
  "another": { version: "v0.40.3" },
} satisfies Record<string, unknown>;`;

function sourceUpdate(): PresetUpdate {
  return {
    slug: 'pocketbase',
    previous: {
      version: preset.version,
      binary: preset.deployLink.binary,
      sha256: preset.deployLink.sha256,
    },
    next: { version: nextVersion, binary: nextBinary, sha256: nextChecksum },
    releaseUrl: release({}).html_url,
  };
}

test('source editing preserves unrelated fields, presets and runtime settings', () => {
  const update = sourceUpdate();
  const written = updatePresetSource({ source, updates: [update] });
  expect(written).toContain(`version: "${nextVersion}"`);
  expect(written).toContain(`binary: "${nextBinary}"`);
  expect(written).toContain(`sha256: "${nextChecksum}"`);
  expect(written).toContain('subtitle: "v0.40.3"');
  expect(written).toContain('env: ["VERSION=v0.40.3"]');
  expect(written).toContain('"another": { version: "v0.40.3" }');
  expect(
    updatePresetSource({
      source: written,
      updates: [{ ...update, previous: update.next, next: update.previous }],
    }),
  ).toBe(source);
});

test('source editing refuses stale input instead of changing the wrong literal', () => {
  const update = sourceUpdate();
  expect(() =>
    updatePresetSource({
      source,
      updates: [{ ...update, previous: { ...update.previous, version: 'v0.1.0' } }],
    }),
  ).toThrow('Unexpected preset value for version');
});

test('the same target pins keep their proposal identity across checks and ordering changes', () => {
  const update = sourceUpdate();
  const another = { ...update, slug: 'another' };
  const proposal = presetUpdateProposal([update, another]);
  expect(
    presetUpdateProposal([
      another,
      { ...update, previous: { ...update.previous, version: 'v0.40.2' } },
    ]).branch,
  ).toBe(proposal.branch);
  expect(proposal.body).toContain(`[${nextVersion}](${update.releaseUrl})`);
});

test('a new version or checksum creates a distinct proposal', () => {
  const update = sourceUpdate();
  const proposal = presetUpdateProposal([update]);
  expect(
    presetUpdateProposal([{ ...update, next: { ...update.next, version: 'v0.40.5' } }]).branch,
  ).not.toBe(proposal.branch);
  expect(
    presetUpdateProposal([
      { ...update, next: { ...update.next, sha256: 'b'.repeat(SHA256_HEX_LENGTH) } },
    ]).branch,
  ).not.toBe(proposal.branch);
});
