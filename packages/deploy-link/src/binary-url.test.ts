import { expect, test } from 'bun:test';
import { namedByUrl, refusedUrl } from '#binary-url.ts';

const RELEASE = 'https://github.com/me/app/releases/download/v1/my-server';

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
