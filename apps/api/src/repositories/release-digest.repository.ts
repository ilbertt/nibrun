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

const REMAINING_HEADER = 'x-ratelimit-remaining';
const RESET_HEADER = 'x-ratelimit-reset';
const EXHAUSTED = '0';
const MS_PER_SECOND = 1000;

type ReleaseResponse = {
  assets?: { name?: unknown; digest?: unknown }[];
};

/**
 * What the release had to say, rather than the digest alone.
 *
 * Only one of these is a digest, and the rest are all the same thing to the fetch that follows —
 * it goes ahead unheld. They are told apart because one of them is worth somebody hearing about:
 * being rate limited is the whole feature switched off, and it is indistinguishable from an
 * ordinary quiet answer unless this end says which it was.
 */
export type PublishedDigest =
  | { outcome: 'published'; digest: Sha256Digest }
  // The url downloads no release asset, which is most urls and never worth a word.
  | { outcome: 'not-a-release' }
  | { outcome: 'rate-limited'; until: Date | undefined }
  | { outcome: 'unavailable' }
  // The release is there and says nothing about the asset: every one published before GitHub
  // began computing these, and any url naming a file the release does not list.
  | { outcome: 'undigested' };

export abstract class ReleaseDigestRepositoryContract {
  abstract publishedDigest(input: { url: string }): Promise<PublishedDigest>;
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

  async publishedDigest({ url }: { url: string }): Promise<PublishedDigest> {
    const asset = releaseAsset(url);
    if (asset === undefined) {
      return { outcome: 'not-a-release' };
    }

    const reached = await this.release({ url: `${this.api}/${releaseApiPath(asset)}` });
    if (reached.outcome !== 'answered') {
      return reached;
    }

    const published = reached.release.assets?.find((each) => each.name === asset.filename)?.digest;
    const digest = typeof published === 'string' ? digestOf(published) : undefined;

    return digest === undefined ? { outcome: 'undigested' } : { outcome: 'published', digest };
  }

  private async release({ url }: { url: string }): Promise<Reached> {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(DEADLINE_MS),
      });
      if (response.ok) {
        return { outcome: 'answered', release: (await response.json()) as ReleaseResponse };
      }
      return refusal(response);
    } catch {
      // A timeout, a name that does not resolve, a body that is not json. None of them is a
      // verdict on the release, and all of them leave the download to happen as it would have.
      return { outcome: 'unavailable' };
    }
  }
}

type Reached =
  | { outcome: 'answered'; release: ReleaseResponse }
  | { outcome: 'rate-limited'; until: Date | undefined }
  | { outcome: 'unavailable' };

/**
 * A refusal read for whether it is the quota rather than the request.
 *
 * `x-ratelimit-remaining` is what tells them apart: GitHub spends 403 on both an exhausted quota
 * and a request it will not answer, so the status alone would report the one thing worth acting on
 * every time anything went wrong.
 */
function refusal(response: Response): Reached {
  return response.headers.get(REMAINING_HEADER) === EXHAUSTED
    ? { outcome: 'rate-limited', until: resetsAt(response.headers) }
    : { outcome: 'unavailable' };
}

/** When the quota comes back, where the header saying so is one this end can read. */
function resetsAt(headers: Headers): Date | undefined {
  const reset = Number(headers.get(RESET_HEADER));
  return Number.isFinite(reset) && reset > 0 ? new Date(reset * MS_PER_SECOND) : undefined;
}

/** The digest as this api spells one, or nothing where it is not a sha256 after all. */
function digestOf(published: string): Sha256Digest | undefined {
  const hex = published.startsWith(DIGEST_PREFIX)
    ? published.slice(DIGEST_PREFIX.length).toLowerCase()
    : undefined;
  return hex !== undefined && Value.Check(Sha256DigestSchema, hex) ? hex : undefined;
}
