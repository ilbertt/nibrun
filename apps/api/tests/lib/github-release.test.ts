import { describe, expect, test } from 'bun:test';
import { releaseApiPath, releaseAsset } from '#lib/github-release.ts';

const PINNED = 'https://github.com/pocketbase/pocketbase/releases/download/v0.40.1/pb_linux.zip';
const MOVING = 'https://github.com/pocketbase/pocketbase/releases/latest/download/pb_linux.zip';

describe('a release asset is recognised by the url that downloads it', () => {
  test('a pinned download names the release it belongs to', () => {
    expect(releaseAsset(PINNED)).toEqual({
      owner: 'pocketbase',
      repo: 'pocketbase',
      tag: 'v0.40.1',
      filename: 'pb_linux.zip',
    });
  });

  /**
   * The shape a README reaches for, and the one a url could never be a cache key on its own: it
   * is whatever they released last. Asking what it currently is, is the whole point.
   */
  test('a moving download names no release, because it is whichever is current', () => {
    expect(releaseAsset(MOVING)).toEqual({
      owner: 'pocketbase',
      repo: 'pocketbase',
      tag: undefined,
      filename: 'pb_linux.zip',
    });
  });

  test('a name that reached the path escaped is the name the release describes', () => {
    expect(
      releaseAsset('https://github.com/me/app/releases/download/v1/my%20server')?.filename,
    ).toBe('my server');
  });

  const NAMES_NOTHING = {
    'a release host that is not GitHub': 'https://gitlab.com/me/app/releases/download/v1/app',
    'a repository page': 'https://github.com/me/app',
    'the releases index': 'https://github.com/me/app/releases',
    'a path of the right length that is not a download': 'https://github.com/a/b/blob/c/d/e',
    'a url that parses as nothing': 'not-a-url',
  };

  for (const [what, url] of Object.entries(NAMES_NOTHING)) {
    test(`${what} names no asset`, () => {
      expect(releaseAsset(url)).toBeUndefined();
    });
  }
});

describe('the release is asked about at an address built from what was parsed', () => {
  test('a pinned download asks about its tag', () => {
    expect(
      releaseApiPath(releaseAsset(PINNED) as NonNullable<ReturnType<typeof releaseAsset>>),
    ).toBe('repos/pocketbase/pocketbase/releases/tags/v0.40.1');
  });

  test('a moving one asks which is current', () => {
    expect(
      releaseApiPath(releaseAsset(MOVING) as NonNullable<ReturnType<typeof releaseAsset>>),
    ).toBe('repos/pocketbase/pocketbase/releases/latest');
  });

  /**
   * A tag reaches here as the path wrote it, still escaped — so the escaping is what has to
   * survive being put in a second url. Escaped again rather than expanded: a tag holding slashes
   * is one segment of the release api's path, not three.
   */
  test('a tag carrying escaped slashes stays one segment', () => {
    expect(releaseApiPath({ owner: 'me', repo: 'app', tag: '..%2f..%2fzz', filename: 'app' })).toBe(
      'repos/me/app/releases/tags/..%252f..%252fzz',
    );
  });
});

/**
 * The url is parsed before any of it is read, and a path that climbs is resolved away by the
 * parser — so a download url cannot name a release other than the one its own path spells.
 */
describe('a path that tries to climb never names an asset', () => {
  const CLIMBS = {
    'an escaped dot segment': 'https://github.com/a/b/releases/download/%2e%2e/x',
    'a plain one': 'https://github.com/a/../releases/download/v1/x',
  };

  for (const [what, url] of Object.entries(CLIMBS)) {
    test(`${what} is resolved away rather than followed`, () => {
      expect(releaseAsset(url)).toBeUndefined();
    });
  }
});
