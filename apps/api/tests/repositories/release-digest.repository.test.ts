import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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

beforeAll(() => {
  releases = Bun.serve({ port: 0, fetch: answer });
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
  const release = RELEASES[pathname];
  return release === undefined
    ? new Response('no such release', { status: 404 })
    : Response.json(release);
}

describe('a release is asked what its own asset hashes to', () => {
  test('the asset is found by name and its digest read off the release', async () => {
    expect(await repo().publishedDigest({ url: downloadOf(ASSET) })).toBe(PUBLISHED);
  });

  test('a moving download asks which release is current', async () => {
    asked = [];

    const digest = await repo().publishedDigest({
      url: `https://github.com/pocketbase/pocketbase/releases/latest/download/${ASSET}`,
    });

    expect(digest).toBe(PUBLISHED);
    expect(asked).toEqual(['/repos/pocketbase/pocketbase/releases/latest']);
  });

  /**
   * GitHub began computing these part way through 2025, so every release older than that names
   * its assets and says nothing about them. The download happens as it always did.
   */
  test('a release from before GitHub computed them says nothing', async () => {
    const url =
      'https://github.com/pocketbase/pocketbase/releases/download/v0.22.0/pocketbase_linux_amd64.zip';

    expect(await repo().publishedDigest({ url })).toBeUndefined();
  });

  test('an asset the release does not list is not guessed at', async () => {
    expect(await repo().publishedDigest({ url: downloadOf('pocketbase_windows.zip') })).toBe(
      undefined,
    );
  });

  /**
   * Sixty an hour unauthenticated, so this is the ordinary answer rather than the exceptional
   * one — and it has to be indistinguishable from not knowing, because that is what it is.
   */
  test('a release api that refuses is the same answer as one that never had a digest', async () => {
    const url = 'https://github.com/pocketbase/pocketbase/releases/download/v9.9.9/app';

    expect(await repo().publishedDigest({ url })).toBeUndefined();
  });

  test('a url that names no release asset is never asked about', async () => {
    asked = [];

    expect(
      await repo().publishedDigest({ url: 'https://releases.example.com/v1/my-server' }),
    ).toBeUndefined();
    expect(asked).toEqual([]);
  });
});
