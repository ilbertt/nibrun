import { namedByUrl } from '@repo/deploy-link';

/**
 * A url for the api to fetch, and what a link said the file there should hash to.
 *
 * The checksum is text rather than a digest because it is whatever the link was written with, and
 * what is not a sha256 is refused by name rather than dropped — see `refusedChecksum`. A checksum
 * quietly ignored is a deploy nobody verified, which is the one thing carrying one was for.
 */
export type FetchedFile = { url: string; sha256?: string | undefined };

/**
 * Where the file is coming from: a file on this machine, or a url the api fetches it at.
 *
 * The two are one value because a field holds one file. Whichever box was last used is what the
 * form holds, and the other is empty because there is nothing else it could be.
 */
export type FileSource = File | FetchedFile;

export function pickedFile(source: FileSource | undefined): File | undefined {
  return source instanceof File ? source : undefined;
}

export function fetchedFile(source: FileSource | undefined): FetchedFile | undefined {
  return source === undefined || source instanceof File ? undefined : source;
}

export function fetchedUrl(source: FileSource | undefined): string | undefined {
  return fetchedFile(source)?.url;
}

/**
 * A url the owner is still typing is not yet a source, and an empty box is not one at all.
 *
 * Whatever a link brought is gone as soon as one is typed over it: a checksum belongs to the url
 * it was written beside, and held against a different one it would refuse a deploy for a reason
 * nobody on this side of the form can see.
 */
export function sourceFromUrl(url: string): FileSource | undefined {
  return url.trim() === '' ? undefined : { url: url.trim() };
}

/** What the file is called, however it is being delivered: the file, or the file the url ends in. */
export function sourceName(source: FileSource | undefined): string | undefined {
  const file = pickedFile(source);
  if (file !== undefined) {
    return file.name;
  }
  const url = fetchedUrl(source);
  return url === undefined ? undefined : namedByUrl(url);
}
