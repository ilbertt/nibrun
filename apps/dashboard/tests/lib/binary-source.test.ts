import { expect, test } from 'bun:test';
import {
  binaryName,
  fetchedUrl,
  namedByUrl,
  pickedFile,
  refusedUrl,
  sourceFromUrl,
} from '#lib/binary-source.ts';

const URL_SOURCE = 'https://github.com/me/app/releases/download/v1/my-server';
const FILE = new File([], 'my-server');

test('a file and a url are both the binary, and each is only itself', () => {
  expect(pickedFile(FILE)).toBe(FILE);
  expect(fetchedUrl(FILE)).toBeUndefined();
  expect(fetchedUrl({ url: URL_SOURCE })).toBe(URL_SOURCE);
  expect(pickedFile({ url: URL_SOURCE })).toBeUndefined();
});

test('what the binary is called is answered the same way for both', () => {
  expect(binaryName(FILE)).toBe('my-server');
  expect(binaryName({ url: URL_SOURCE })).toBe('my-server');
  expect(binaryName(undefined)).toBeUndefined();
});

// A box being cleared has to leave the field empty rather than holding a url of no characters,
// which would read as a binary that was chosen.
test('an empty box is not a binary', () => {
  expect(sourceFromUrl('')).toBeUndefined();
  expect(sourceFromUrl('   ')).toBeUndefined();
  expect(sourceFromUrl(` ${URL_SOURCE} `)).toEqual({ url: URL_SOURCE });
});

/**
 * Said here rather than by the api, because the api is the end that follows the url: a mistake it
 * would answer with is one the owner would otherwise wait through a deploy to hear about.
 */
test('a url nibrun could not fetch a binary from is refused before the deploy', () => {
  expect(refusedUrl(URL_SOURCE)).toBeUndefined();
  expect(refusedUrl('http://releases.test/my-server')).toContain('https');
  expect(refusedUrl('https://releases.test/downloads/')).toContain('name');
  expect(namedByUrl('https://releases.test/../etc/passwd')).toBe('passwd');
});
