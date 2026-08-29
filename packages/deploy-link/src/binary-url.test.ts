import { expect, test } from 'bun:test';
import { namedByUrl, refusedChecksum, refusedUrl } from '#binary-url.ts';

const RELEASE = 'https://github.com/me/app/releases/download/v1/my-server';
const CHECKSUM = 'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298';

/**
 * Said here rather than by the api, because the api is the end that follows the url: a mistake it
 * would answer with is one the owner would otherwise wait through a deploy to hear about.
 */
test('a url nibrun could not fetch a binary from is refused before the deploy', () => {
  expect(refusedUrl(RELEASE)).toBeUndefined();
  expect(refusedUrl('http://releases.test/my-server')).toContain('https');
  expect(refusedUrl('https://releases.test/downloads/')).toContain('name');
});

test('what the binary at a url is called is the segment it ends in', () => {
  expect(namedByUrl(RELEASE)).toBe('my-server');
  expect(namedByUrl('https://releases.test/../etc/passwd')).toBe('passwd');
});

// Refused rather than ignored: what a dropped checksum would let through is the deploy nobody
// verified, which is the one thing carrying one was for.
test('a checksum that is not a sha256 is refused before the deploy', () => {
  expect(refusedChecksum(undefined)).toBeUndefined();
  expect(refusedChecksum(CHECKSUM)).toBeUndefined();
  expect(refusedChecksum(CHECKSUM.slice(1))).toContain('64 hex');
  expect(refusedChecksum(`sha256:${CHECKSUM}`)).toContain('64 hex');
});
