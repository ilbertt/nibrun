import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Sha256DigestSchema, Value } from '@repo/protocol';
import { ReleaseDigestRepository } from '#repositories/release-digest.repository.ts';

const ASSET = 'pocketbase_linux_amd64.zip';
const PUBLISHED = Value.Parse(
  Sha256DigestSchema,
  '0f3442d2e57b03b56fbff0d09289e4a30b4f561a44338c38d2dcd4a1a0cfa91e',
);

/**
 * Answered by a real server rather than a fake, because what is worth testing here is the shape
 * GitHub replies in: a digest that arrives prefixed with its own algorithm, an asset matched out
 * of a list of them, and a release old enough to have none. A stand-in returning a digest would
 * only be restating what this repository is for.
 */
let releases: ReturnType<typeof Bun.serve>;
let asked: string[] = [];

/** What the api is doing with the caller's quota, which every path below answers through. */
type Quota = 'available' | 'exhausted' | 'exhausted-without-reset' | 'refused';
let quota: Quota = 'available';

const RESETS_AT = 1_788_350_550;
const MS_PER_SECOND = 1000;
const REFUSED = 403;
const REMAINING_WHEN_REFUSED = '59';

beforeAll(() => {
  releases = Bun.serve({ port: 0, fetch: answer });
});

beforeEach(() => {
  quota = 'available';
});

afterAll(() => {
  releases.stop(true);
});

function repo(): ReleaseDigestRepository {
  return new ReleaseDigestRepository({ api: releases.url.origin });
}

function downloadOf(name: string): string {
  return `https://github.com/pocketbase/pocketbase/releases/download/v0.40.1/${name}`;
}

/** The releases the server below knows about, keyed by the path GitHub describes them at. */
const RELEASES: Record<string, unknown> = {
  '/repos/pocketbase/pocketbase/releases/tags/v0.40.1': {
    assets: [
      { name: 'checksums.txt', digest: `sha256:${'c'.repeat(PUBLISHED.length)}` },
      { name: ASSET, digest: `sha256:${PUBLISHED}` },
    ],
  },
  // What every release published before GitHub began computing them looks like.
  '/repos/pocketbase/pocketbase/releases/tags/v0.22.0': {
    assets: [{ name: ASSET, digest: null }],
  },
  '/repos/pocketbase/pocketbase/releases/latest': {
    assets: [{ name: ASSET, digest: `sha256:${PUBLISHED}` }],
  },
};

function answer(request: Request): Response {
  const { pathname } = new URL(request.url);
  asked.push(pathname);
  if (quota !== 'available') {
    return refusal();
  }
  const release = RELEASES[pathname];
  return release === undefined
    ? new Response('no such release', { status: 404 })
    : Response.json(release);
}

/** A 403, spent the two ways GitHub spends one: on an empty quota, and on anything else. */
function refusal(): Response {
  if (quota === 'refused') {
    return new Response('forbidden', {
      status: REFUSED,
      headers: { 'x-ratelimit-remaining': REMAINING_WHEN_REFUSED },
    });
  }
  const headers: Record<string, string> = { 'x-ratelimit-remaining': '0' };
  if (quota === 'exhausted') {
    headers['x-ratelimit-reset'] = String(RESETS_AT);
  }
  return new Response('rate limit exceeded', { status: REFUSED, headers });
}

describe('a release is asked what its own asset hashes to', () => {
  test('the asset is found by name and its digest read off the release', async () => {
    expect(await repo().publishedDigest({ url: downloadOf(ASSET) })).toEqual({
      outcome: 'published',
      digest: PUBLISHED,
    });
  });

  test('a moving download asks which release is current', async () => {
    asked = [];

    const digest = await repo().publishedDigest({
      url: `https://github.com/pocketbase/pocketbase/releases/latest/download/${ASSET}`,
    });

    expect(digest).toEqual({ outcome: 'published', digest: PUBLISHED });
    expect(asked).toEqual(['/repos/pocketbase/pocketbase/releases/latest']);
  });

  /**
   * GitHub began computing these part way through 2025, so every release older than that names
   * its assets and says nothing about them. The download happens as it always did.
   */
  test('a release from before GitHub computed them says nothing', async () => {
    const url =
      'https://github.com/pocketbase/pocketbase/releases/download/v0.22.0/pocketbase_linux_amd64.zip';

    expect(await repo().publishedDigest({ url })).toEqual({ outcome: 'undigested' });
  });

  test('an asset the release does not list is not guessed at', async () => {
    expect(await repo().publishedDigest({ url: downloadOf('pocketbase_windows.zip') })).toEqual({
      outcome: 'undigested',
    });
  });

  test('a release the api does not have is unavailable rather than undigested', async () => {
    const url = 'https://github.com/pocketbase/pocketbase/releases/download/v9.9.9/app';

    expect(await repo().publishedDigest({ url })).toEqual({ outcome: 'unavailable' });
  });

  test('a url that names no release asset is never asked about', async () => {
    asked = [];

    expect(
      await repo().publishedDigest({ url: 'https://releases.example.com/v1/my-server' }),
    ).toEqual({ outcome: 'not-a-release' });
    expect(asked).toEqual([]);
  });
});

/**
 * Sixty an hour is what an unauthenticated caller gets, so this is the state nibrun spends most of
 * its time in — and the one outcome anybody can act on. It has to be told apart from a quiet
 * afternoon, which is the whole of why the outcome is not just `undefined`.
 */
describe('a quota that has run out says so rather than going quiet', () => {
  test('an exhausted quota is named, with when it comes back', async () => {
    quota = 'exhausted';

    expect(await repo().publishedDigest({ url: downloadOf(ASSET) })).toEqual({
      outcome: 'rate-limited',
      until: new Date(RESETS_AT * MS_PER_SECOND),
    });
  });

  /**
   * GitHub spends 403 on an exhausted quota and on a request it will not answer, so the status
   * alone would report the actionable one every time anything at all went wrong.
   */
  test('a refusal that is not the quota is not reported as one', async () => {
    quota = 'refused';

    expect(await repo().publishedDigest({ url: downloadOf(ASSET) })).toEqual({
      outcome: 'unavailable',
    });
  });

  test('a quota that is exhausted without saying when says only that much', async () => {
    quota = 'exhausted-without-reset';

    expect(await repo().publishedDigest({ url: downloadOf(ASSET) })).toEqual({
      outcome: 'rate-limited',
      until: undefined,
    });
  });
});
