import { type Sha256Digest, Sha256DigestSchema, Value } from '@repo/protocol';
import { RELEASE_API, releaseApiPath, releaseAsset } from '#lib/github-release.ts';

/**
 * Short, because this runs before a download rather than instead of one. Everything it could
 * answer is an optimisation, so a release api that is slow to say costs the caller nothing beyond
 * this and the fetch goes ahead the way it always did.
 */
const DEADLINE_MS = 5_000;

// GitHub answers a request without one with a 403, and the name is the only thing it asks for.
const USER_AGENT = 'nibrun';

const DIGEST_PREFIX = 'sha256:';

type ReleaseResponse = {
  assets?: { name?: unknown; digest?: unknown }[];
};

export abstract class ReleaseDigestRepositoryContract {
  abstract publishedDigest(input: { url: string }): Promise<Sha256Digest | undefined>;
}

/**
 * What a release host says its own asset hashes to, asked before the bytes are fetched.
 *
 * This is what makes a link with no checksum in it as fast as one that has it: a digest is the
 * only key that names a download exactly, and most deploy buttons point at a release rather than
 * carrying a checksum somebody worked out by hand. Asking turns a url into that key — and unlike
 * the url, it stops being the same key the moment the asset behind it is replaced.
 *
 * Unauthenticated, so it is rate limited to sixty an hour across everything sharing this address.
 * Every failure is the same answer as an unknown digest: the download happens as it would have,
 * and nothing a caller asked for depends on this having worked.
 */
export class ReleaseDigestRepository implements ReleaseDigestRepositoryContract {
  private readonly api: string;

  /**
   * Which address answers for the release api, defaulting to the only one production has any
   * business asking. It is an argument at all so that a test can point one of these at a server on
   * the machine running it, and describe a release the way GitHub does.
   */
  constructor({ api = RELEASE_API }: { api?: string } = {}) {
    this.api = api;
  }

  async publishedDigest({ url }: { url: string }): Promise<Sha256Digest | undefined> {
    const asset = releaseAsset(url);
    if (asset === undefined) {
      return undefined;
    }

    const release = await this.release({ url: `${this.api}/${releaseApiPath(asset)}` });
    const published = release?.assets?.find((each) => each.name === asset.filename)?.digest;

    return typeof published === 'string' ? digestOf(published) : undefined;
  }

  private async release({ url }: { url: string }): Promise<ReleaseResponse | undefined> {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(DEADLINE_MS),
      });
      return response.ok ? ((await response.json()) as ReleaseResponse) : undefined;
    } catch {
      return undefined;
    }
  }
}

/** The digest as this api spells one, or nothing where it is not a sha256 after all. */
function digestOf(published: string): Sha256Digest | undefined {
  const hex = published.startsWith(DIGEST_PREFIX)
    ? published.slice(DIGEST_PREFIX.length).toLowerCase()
    : undefined;
  return hex !== undefined && Value.Check(Sha256DigestSchema, hex) ? hex : undefined;
}
