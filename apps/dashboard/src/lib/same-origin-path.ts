// A leading slash alone still leaves the origin: `//host` and `/\host` are protocol-relative, and
// the URL parser drops tabs and newlines before it looks, so `/<tab>/host` is one of them too.
const SAME_ORIGIN_PATH = /^\/(?![/\\])[^\s\\]*$/;

export function sameOriginPath(candidate: unknown): string | undefined {
  return typeof candidate === 'string' && SAME_ORIGIN_PATH.test(candidate) ? candidate : undefined;
}
