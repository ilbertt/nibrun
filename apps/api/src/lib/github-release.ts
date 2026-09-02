const RELEASE_HOST = 'github.com';
const RELEASES = 'releases';
const DOWNLOAD = 'download';
const LATEST = 'latest';
const RELEASE_PATH_SEGMENTS = 6;

/** Where GitHub describes its own releases; see the note on the repository's constructor. */
export const RELEASE_API = 'https://api.github.com';

/**
 * A release asset named the way GitHub addresses it, rather than the way it is downloaded. The tag
 * is absent for the moving url a project points at from its README — the one that is whatever they
 * released last, and so the one a digest is worth asking about rather than assuming.
 */
export type ReleaseAsset = {
  owner: string;
  repo: string;
  tag: string | undefined;
  filename: string;
};

/**
 * The release asset a url downloads, where it is one.
 *
 * Both shapes GitHub serves are the same length and differ by one segment, so they are told apart
 * by that segment rather than by counting: `/releases/download/<tag>/<file>` names a release, and
 * `/releases/latest/download/<file>` names whichever is current.
 *
 * Undefined for every other url, which is most of them — a release host that is not GitHub, a
 * repository page, an address that happens to be on the same domain. There is nothing to fall back
 * to and nothing lost: not knowing a digest is the state everything here was already in.
 */
export function releaseAsset(url: string): ReleaseAsset | undefined {
  const parsed = parse(url);
  if (parsed === undefined || parsed.hostname !== RELEASE_HOST) {
    return undefined;
  }
  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length !== RELEASE_PATH_SEGMENTS || segments[2] !== RELEASES) {
    return undefined;
  }

  const [owner, repo, , kind, fourth, fifth] = segments;
  if (owner === undefined || repo === undefined || fifth === undefined) {
    return undefined;
  }
  if (kind === DOWNLOAD) {
    return { owner, repo, tag: fourth, filename: decoded(fifth) };
  }
  return kind === LATEST && fourth === DOWNLOAD
    ? { owner, repo, tag: undefined, filename: decoded(fifth) }
    : undefined;
}

/**
 * Where the release is described, below whichever address is answering for the api.
 *
 * Every segment is escaped on its way in. A tag reaches here as the path spelled it — still
 * escaped — so one holding slashes is escaped again rather than becoming three segments of a
 * different endpoint.
 */
export function releaseApiPath({ owner, repo, tag }: ReleaseAsset): string {
  const release = tag === undefined ? LATEST : `tags/${encodeURIComponent(tag)}`;
  return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${RELEASES}/${release}`;
}

// A name with a space in it reaches the path escaped, and it is the unescaped one the release
// describes. A malformed escape is a url naming no asset rather than one that throws.
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
