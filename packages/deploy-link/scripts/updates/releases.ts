import { createHash } from 'node:crypto';
import type { DeployPreset } from '#presets.ts';

const REQUEST_TIMEOUT_MS = 120_000;
const GITHUB_RELEASE_PATH = /^\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/;
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/;

export type PresetPin = Pick<DeployPreset, 'version'> & {
  binary: string;
  sha256: string | undefined;
};

export type PresetUpdate = {
  slug: string;
  previous: PresetPin;
  next: PresetPin;
  releaseUrl: string;
};

export type Release = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  assets: { name: string; browser_download_url: string; digest: string | null }[];
};

type UpdateOptions = {
  slug: string;
  preset: DeployPreset;
  request: (url: string) => Promise<Response>;
};

export async function findUpdate(options: UpdateOptions): Promise<PresetUpdate | undefined> {
  const { preset, request, slug } = options;
  if (!preset.deployLink.binary) {
    throw new Error(`No binary URL for ${slug}`);
  }
  const previous = {
    version: preset.version,
    binary: preset.deployLink.binary,
    sha256: preset.deployLink.sha256,
  };
  // Rolling releases intentionally carry no pin: their download already follows new builds.
  if (previous.sha256 === undefined) {
    return undefined;
  }
  const url = new URL(previous.binary);
  if (url.hostname !== 'github.com') {
    return findDrizzleUpdate({ ...options, previous });
  }
  const match = GITHUB_RELEASE_PATH.exec(url.pathname);
  if (!match) {
    throw new Error(`Unsupported release URL: ${url}`);
  }
  const repository = match[1]!;
  const tag = match[2]!;
  const encodedName = match[3]!;
  if (decodeURIComponent(tag) !== previous.version) {
    throw new Error(`Version and binary tag disagree for ${slug}`);
  }
  const endpoint = `https://api.github.com/repos/${repository}/releases`;
  const latest = (await (await request(`${endpoint}/latest`)).json()) as Release;
  if (latest.tag_name === previous.version || latest.draft || latest.prerelease) {
    return undefined;
  }
  const current = (await (await request(`${endpoint}/tags/${tag}`)).json()) as Release;
  if (Date.parse(latest.published_at) <= Date.parse(current.published_at)) {
    return undefined;
  }
  const name = updatedAssetName({ name: decodeURIComponent(encodedName), previous, latest });
  const asset = latest.assets.find((candidate) => candidate.name === name);
  if (!asset) {
    throw new Error(`${latest.tag_name} has no asset named ${name}`);
  }
  const digest = asset.digest?.match(SHA256_DIGEST)?.[1];
  if (asset.digest && !digest) {
    throw new Error(`Unsupported asset digest: ${asset.digest}`);
  }
  return {
    slug,
    previous,
    next: {
      version: latest.tag_name,
      binary: asset.browser_download_url,
      sha256: digest ?? (await downloadChecksum({ request, url: asset.browser_download_url })),
    },
    releaseUrl: latest.html_url,
  };
}

export function updatedAssetName(options: {
  name: string;
  previous: PresetPin;
  latest: Pick<Release, 'tag_name'>;
}): string {
  const { name, previous, latest } = options;
  const placeholder = '{version}';
  const tagPlaceholder = '{tag}';
  return name
    .replaceAll(previous.version, tagPlaceholder)
    .replaceAll(previous.version.replace(/^v/, ''), placeholder)
    .replaceAll(tagPlaceholder, latest.tag_name)
    .replaceAll(placeholder, latest.tag_name.replace(/^v/, ''));
}

async function findDrizzleUpdate(options: UpdateOptions & { previous: PresetPin }) {
  const { preset, previous, request, slug } = options;
  if (preset.projectUrl !== 'https://gateway.drizzle.team') {
    throw new Error(`Unsupported release source: ${preset.projectUrl}`);
  }
  const releaseUrl = `${preset.projectUrl}/docs/binary`;
  const page = await (await request(releaseUrl)).text();
  const links = [
    ...page.matchAll(/https:\/\/[^\s<>"']+\/drizzle-gateway-(\d+\.\d+\.\d+)-linux-x64/g),
  ];
  const downloads = new Map(links.map((match) => [match[1]!, match[0]]));
  if (downloads.size !== 1) {
    throw new Error('Expected one current Drizzle Gateway Linux x64 download');
  }
  const [version, binary] = [...downloads.entries()][0]!;
  if (!Bun.semver.satisfies(version, `>${previous.version.replace(/^v/, '')}`)) {
    return undefined;
  }
  return {
    slug,
    previous,
    next: {
      version: `v${version}`,
      binary,
      sha256: await downloadChecksum({ request, url: binary }),
    },
    releaseUrl,
  };
}

async function downloadChecksum(options: {
  request: UpdateOptions['request'];
  url: string;
}): Promise<string> {
  const response = await options.request(options.url);
  if (!response.body) {
    throw new Error(`No download body: ${options.url}`);
  }
  const hash = createHash('sha256');
  for await (const chunk of response.body) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function requestRelease(input: Parameters<typeof fetch>[0]): Promise<Response> {
  const url = new URL(String(input));
  const headers = new Headers();
  if (url.hostname === 'api.github.com') {
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', '2026-03-10');
    if (process.env.GITHUB_TOKEN) {
      headers.set('Authorization', `Bearer ${process.env.GITHUB_TOKEN}`);
    }
  }
  const response = await fetch(input, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response;
}
