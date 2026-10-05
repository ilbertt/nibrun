const SPACE_CODE = 32;
const SECURE_SCHEME = 'https://';

/**
 * What the api would refuse, said here instead — a url is followed by the api rather than by the
 * page that carries it, so a mistake in one would otherwise cost a deploy to find out about.
 */
export function refusedUrl(url: string): string | undefined {
  if (!url.startsWith(SECURE_SCHEME)) {
    return 'A binary is fetched over https.';
  }
  return namedByUrl(url) === undefined
    ? 'The url has to end in the binary’s own name, as a release download does.'
    : undefined;
}

/**
 * What the api would refuse, said here for the same reason the url is: the checksum comes from
 * whoever wrote the link, and following one is how anybody finds out it was mistyped. Refused
 * rather than ignored — the deploy it would let through is the unverified one.
 */
export function refusedChecksum(sha256: string | undefined): string | undefined {
  return sha256 === undefined || /^[0-9a-f]{64}$/.test(sha256)
    ? undefined
    : 'The link’s checksum is not a sha256: 64 hex characters.';
}

/** What the binary at a url is called, which is the name an export would carry. */
export function namedByUrl(url: string): string | undefined {
  const segment = lastSegment(url);
  return segment !== undefined &&
    segment.length > 0 &&
    segment !== '.' &&
    segment !== '..' &&
    !/[\\/]/.test(segment) &&
    ![...segment].some((character) => character.charCodeAt(0) < SPACE_CODE)
    ? segment
    : undefined;
}

function lastSegment(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
  } catch {
    return undefined;
  }
}
