import type { FetchableBinary } from '@repo/app-operations';
import { FilenameSchema, Value } from '@repo/protocol';

const SECURE_SCHEME = 'https://';

/**
 * Where the binary is coming from: a file on this machine, or a url the api fetches it at.
 *
 * The two are one value because a deploy has one binary. Whichever box was last used is what the
 * form holds, and the other is empty because there is nothing else it could be.
 */
export type BinarySource = File | FetchableBinary;

export function pickedFile(source: BinarySource | undefined): File | undefined {
  return source instanceof File ? source : undefined;
}

export function fetchedUrl(source: BinarySource | undefined): string | undefined {
  return source === undefined || source instanceof File ? undefined : source.url;
}

/** A url the owner is still typing is not yet a source, and an empty box is not one at all. */
export function sourceFromUrl(url: string): BinarySource | undefined {
  return url.trim() === '' ? undefined : { url: url.trim() };
}

/**
 * What the api would refuse, said here instead — a url is followed by the api rather than by this
 * page, so a mistake in one would otherwise cost a deploy to find out about.
 */
export function refusedUrl(url: string): string | undefined {
  if (!url.startsWith(SECURE_SCHEME)) {
    return 'A binary is fetched over https.';
  }
  return namedByUrl(url) === undefined
    ? 'The url has to end in the binary’s own name, as a release download does.'
    : undefined;
}

/** What the binary is called, however it is being delivered: the file, or the file the url ends in. */
export function binaryName(source: BinarySource | undefined): string | undefined {
  const file = pickedFile(source);
  if (file !== undefined) {
    return file.name;
  }
  const url = fetchedUrl(source);
  return url === undefined ? undefined : namedByUrl(url);
}

/** What the binary at a url is called, which is the name an export would carry. */
export function namedByUrl(url: string): string | undefined {
  const segment = lastSegment(url);
  return segment !== undefined && Value.Check(FilenameSchema, segment) ? segment : undefined;
}

function lastSegment(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
  } catch {
    return undefined;
  }
}
