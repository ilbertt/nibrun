import { type Filename, FilenameSchema, Value } from '@repo/protocol';

// Where a binary may be fetched from rather than uploaded. `https` alone: the api is what follows
// this, and a plaintext hop is one where what the guest ends up running was chosen by whoever sat
// between.
//
// The api's own, not the protocol's: a host is told a digest and a key, never where the bytes were
// found, so this reaches nothing below the control plane.
export const BINARY_URL_PATTERN = '^https://[^\\s]+$';
export const MAX_BINARY_URL_LENGTH = 2048;

const BINARY_URL = new RegExp(BINARY_URL_PATTERN);

/**
 * The rule the request body is held to, as something every later hop is held to as well: what the
 * caller typed is only the first address fetched, and a redirect to a plaintext one is exactly the
 * hop the rule exists to refuse.
 */
export function isBinaryUrl(url: string): boolean {
  return url.length <= MAX_BINARY_URL_LENGTH && BINARY_URL.test(url);
}

/**
 * What to call a binary nobody named: the last segment of the url's path, which is where a release
 * host puts the file's own name. Undefined where that is not a name an export could carry — a url
 * ending in a slash, or in something `FilenameSchema` refuses.
 */
export function filenameFromUrl(url: string): Filename | undefined {
  const segment = lastPathSegment(url);
  return segment !== undefined && Value.Check(FilenameSchema, segment) ? segment : undefined;
}

/**
 * The url with whatever a caller authenticated by taken out of it. This is the form that is written
 * down and read back in errors, and a password kept forever in a row — or answered to a browser —
 * is one nobody chose to store.
 */
export function withoutCredentials(url: string): string {
  const parsed = parse(url);
  if (parsed === undefined) {
    return url;
  }
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

// Decoded because that is how a name with a space in it reaches the path. A malformed escape is a
// url that names no file rather than one that throws: it arrived as a request body, and every
// other shape of unusable url here is answered rather than raised.
function lastPathSegment(url: string): string | undefined {
  const parsed = parse(url);
  if (parsed === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(parsed.pathname.split('/').at(-1) ?? '');
  } catch {
    return undefined;
  }
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
