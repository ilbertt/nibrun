const AUTHORIZE_PATH = '/api/auth/oauth2/authorize';

/** better-auth's own parameter on the sign-in redirect, and the only one that is not the request. */
const CALLBACK_PARAM = 'callbackURL';

/**
 * Where signing in should land, given the query better-auth sent the owner here with.
 *
 * An authorize request that has no session is redirected to the sign-in page carrying the whole of
 * itself, so replaying that query against `authorize` is what resumes it. Anything else is the
 * dashboard's own sign-in, and lands wherever it was going.
 */
export function resolveSignInTarget({
  search,
  fallback,
}: {
  search: string;
  fallback: string;
}): string {
  const params = new URLSearchParams(search);
  params.delete(CALLBACK_PARAM);
  const authorizeQuery = params.toString();
  return authorizeQuery === '' ? fallback : `${AUTHORIZE_PATH}?${authorizeQuery}`;
}

/**
 * The query exactly as it arrived.
 *
 * Read off the location rather than the router, and this is load-bearing: better-auth signs the
 * authorize request with repeated `ba_param` keys, and the router's search parser collapses
 * repeated keys into one array-valued entry — which re-serialises into a query whose signature no
 * longer matches. better-auth only ever reaches these pages by a full-document redirect, so what
 * the browser holds is the verbatim signed query.
 */
export function signedQuery(): string {
  return window.location.search.replace(/^\?/, '');
}
