import type { FetchableBinary } from '@repo/app-operations';
import { namedByUrl } from '@repo/deploy-link';

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

/** What the binary is called, however it is being delivered: the file, or the file the url ends in. */
export function binaryName(source: BinarySource | undefined): string | undefined {
  const file = pickedFile(source);
  if (file !== undefined) {
    return file.name;
  }
  const url = fetchedUrl(source);
  return url === undefined ? undefined : namedByUrl(url);
}
