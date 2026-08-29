import { expect, test } from 'bun:test';
import { binaryName, fetchedUrl, pickedFile, sourceFromUrl } from '#lib/binary-source.ts';

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
