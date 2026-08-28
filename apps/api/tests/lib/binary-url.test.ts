import { describe, expect, test } from 'bun:test';
import { FilenameSchema, Value } from '@repo/protocol';
import {
  filenameFromUrl,
  isBinaryUrl,
  MAX_BINARY_URL_LENGTH,
  withoutCredentials,
} from '#lib/binary-url.ts';

const MY_SERVER = Value.Parse(FilenameSchema, 'my-server');

/**
 * The name a host writes into an export archive, taken from the only place a fetched binary has
 * one. Every answer here is a name or the absence of one: the url arrived as a request body, so a
 * url this cannot read is a request to refuse rather than something to raise.
 */
describe('a binary is named after the file at the end of the url', () => {
  test('the last segment of the path is the name', () => {
    expect(filenameFromUrl('https://releases.test/download/v1.2.0/my-server')).toBe(MY_SERVER);
  });

  test('a query is not part of the path, and so not part of the name', () => {
    expect(filenameFromUrl('https://releases.test/my-server?token=abc')).toBe(MY_SERVER);
  });

  test('nor is a fragment', () => {
    expect(filenameFromUrl('https://releases.test/my-server#sha256')).toBe(MY_SERVER);
  });

  test('an escaped name is the name it stands for', () => {
    expect(filenameFromUrl('https://releases.test/my%2Dserver')).toBe(MY_SERVER);
  });

  // Decoded first and checked after, so `%2F` is a name with a separator in it rather than a path.
  test('a segment that decodes to a path is not a name', () => {
    expect(filenameFromUrl('https://releases.test/a%2Fb')).toBeUndefined();
  });

  test('a url ending in a slash names nothing', () => {
    expect(filenameFromUrl('https://releases.test/downloads/')).toBeUndefined();
  });

  test('and neither does one with no path at all — a host is not a binary', () => {
    expect(filenameFromUrl('https://releases.test')).toBeUndefined();
  });

  test('an escape that stands for nothing is a url without a name, not a throw', () => {
    expect(filenameFromUrl('https://releases.test/%zz')).toBeUndefined();
  });

  test('so is something that is not a url', () => {
    expect(filenameFromUrl('not a url')).toBeUndefined();
  });
});

describe('the rule the request body is held to is one a redirect can be held to', () => {
  test('an https address passes it', () => {
    expect(isBinaryUrl('https://releases.test/my-server')).toBe(true);
  });

  test('a plaintext one does not', () => {
    expect(isBinaryUrl('http://releases.test/my-server')).toBe(false);
  });

  test('nor does one longer than a url may be', () => {
    expect(isBinaryUrl(`https://releases.test/${'a'.repeat(MAX_BINARY_URL_LENGTH)}`)).toBe(false);
  });
});

/**
 * What a caller authenticated with belongs to the fetch it was given for. The url is written into
 * a row that outlives that fetch and read back in errors that reach a browser, and neither is
 * somewhere a password was meant to end up.
 */
describe('where the bytes came from is said without what it took to get them', () => {
  test('a password is not part of where a binary came from', () => {
    expect(withoutCredentials('https://owner:ghp_secret@releases.test/my-server')).toBe(
      'https://releases.test/my-server',
    );
  });

  test('a url that carries none is the url it already was', () => {
    expect(withoutCredentials('https://releases.test/my-server?token=abc')).toBe(
      'https://releases.test/my-server?token=abc',
    );
  });

  test('and one that is not a url is left alone rather than lost', () => {
    expect(withoutCredentials('not a url')).toBe('not a url');
  });
});
