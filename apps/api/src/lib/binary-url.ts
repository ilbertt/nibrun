import { type Filename, FilenameSchema, Value } from '@repo/protocol';

// Where a binary may be fetched from rather than uploaded. `https` alone: the api is what follows
// this, and a plaintext hop is one where what the guest ends up running was chosen by whoever sat
// between.
//
// The api's own, not the protocol's: a host is told a digest and a key, never where the bytes were
// found, so this reaches nothing below the control plane.
export const BINARY_URL_PATTERN = '^https://[^\\s]+$';
export const MAX_BINARY_URL_LENGTH = 2048;

/**
 * What to call a binary nobody named: the last segment of the url's path, which is where a release
 * host puts the file's own name. Undefined where that is not a name an export could carry — a url
 * ending in a slash, or in something `FilenameSchema` refuses.
 */
export function filenameFromUrl(url: string): Filename | undefined {
  const path = pathOf(url);
  if (path === undefined) {
    return undefined;
  }
  const segment = decodeURIComponent(path.split('/').at(-1) ?? '');
  return Value.Check(FilenameSchema, segment) ? segment : undefined;
}

function pathOf(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}
