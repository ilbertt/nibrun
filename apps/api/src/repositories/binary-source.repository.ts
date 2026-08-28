import { isBinaryUrl } from '#lib/binary-url.ts';

/**
 * The whole fetch rather than the connect alone: the signal stays with the body, so this is also
 * what bounds a source that answers at once and then trickles. Long enough for the largest binary
 * that may be stored coming over an ordinary link, and short enough that a source which stopped
 * saying anything is a request that failed rather than one still being held.
 */
const FETCH_DEADLINE_MS = 300_000;

/**
 * A chain no longer than the ones release hosts actually serve — an address to a store, and the
 * store to a region. Bounded because a chain that never ends is a fetch that never does.
 */
const MAX_REDIRECTS = 10;

const FIRST_REDIRECT_STATUS = 300;
const FIRST_ERROR_STATUS = 400;

/**
 * A url the api was asked to fetch a binary from, opened but not read. The body is handed over as
 * a stream because a binary is the one thing here too large to hold: whoever asked for it decides
 * where the bytes go, and they go there as they arrive.
 *
 * `declaredSizeBytes` is the source's word about its own length, absent where it gave none — a
 * chunked response, or a host that does not say. It is worth having anyway: it is what lets an
 * object too large to store be refused before a byte of it is fetched.
 */
export type BinarySource =
  | { outcome: 'open'; body: ReadableStream<Uint8Array>; declaredSizeBytes: number | undefined }
  | { outcome: 'unreachable' }
  | { outcome: 'refused'; status: number }
  | { outcome: 'empty' }
  | { outcome: 'insecure-redirect'; to: string }
  | { outcome: 'too-many-redirects' };

/**
 * What a source failing part way through is raised as. Everything downstream of the fetch is this
 * process and its own store, so a read that fails is the one failure in the chain that belongs to
 * the url — and it is answered as the url's rather than as a fault of the api.
 */
export class InterruptedSourceError extends Error {
  constructor(cause: unknown) {
    super('The url stopped sending before the binary was whole.', { cause });
    this.name = 'InterruptedSourceError';
  }
}

export abstract class BinarySourceRepositoryContract {
  abstract open(input: { url: string }): Promise<BinarySource>;
}

export class BinarySourceRepository implements BinarySourceRepositoryContract {
  /**
   * Redirects are followed a hop at a time rather than by `fetch` itself, which is what makes the
   * https rule mean anything: every store that hosts a release answers the address people share
   * with a redirect, and a rule applied to the first address alone is one a `302` to plaintext
   * walks straight around.
   */
  async open({ url }: { url: string }): Promise<BinarySource> {
    const deadline = AbortSignal.timeout(FETCH_DEADLINE_MS);
    let target = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await get({ url: target, deadline });
      if (response === undefined) {
        return { outcome: 'unreachable' };
      }
      const location = redirectTarget({ response, from: target });
      if (location === undefined) {
        return await answered(response);
      }
      await discard(response);
      if (!isBinaryUrl(location)) {
        return { outcome: 'insecure-redirect', to: location };
      }
      target = location;
    }

    return { outcome: 'too-many-redirects' };
  }
}

/**
 * A url that answers nothing is the ordinary failure here rather than a fault of this api: it was
 * typed by whoever wrote the link, and only they can fix it. Undefined rather than the error,
 * because what went wrong at the socket is not something to read back to them.
 */
async function get({
  url,
  deadline,
}: {
  url: string;
  deadline: AbortSignal;
}): Promise<Response | undefined> {
  try {
    return await fetch(url, { redirect: 'manual', signal: deadline });
  } catch {
    return undefined;
  }
}

async function answered(response: Response): Promise<BinarySource> {
  if (!response.ok) {
    await discard(response);
    return { outcome: 'refused', status: response.status };
  }
  if (response.body === null) {
    return { outcome: 'empty' };
  }
  return {
    outcome: 'open',
    body: saidAsTheSource(response.body),
    declaredSizeBytes: declaredLength(response.headers),
  };
}

/**
 * Where a redirect points, resolved against the address that answered with it. Any 3xx carrying a
 * `location` counts: what makes one a hop worth following is that a host named somewhere else to
 * look, not which of the five statuses it chose to say so with.
 */
function redirectTarget({
  response,
  from,
}: {
  response: Response;
  from: string;
}): string | undefined {
  const location = response.headers.get('location');
  if (location === null || !isRedirect(response.status)) {
    return undefined;
  }
  try {
    return new URL(location, from).toString();
  } catch {
    return undefined;
  }
}

function isRedirect(status: number): boolean {
  return status >= FIRST_REDIRECT_STATUS && status < FIRST_ERROR_STATUS;
}

/** A body nobody is going to read holds its connection open until it is let go of. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    return;
  }
}

/**
 * The body as a stream that says whose failure a failure was. What reads it is the same code that
 * reads an object back out of the store, and a socket that dropped part way through is the one
 * thing in that chain nibrun is not the one to answer for.
 */
function saidAsTheSource(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (failure) {
        controller.error(new InterruptedSourceError(failure));
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

// A header that is absent is not a length of zero, and `Number(null)` is — so the header is read
// before it is coerced.
function declaredLength(headers: Headers): number | undefined {
  const declared = headers.get('content-length');
  if (declared === null || declared.trim() === '') {
    return undefined;
  }
  const length = Number(declared);
  return Number.isInteger(length) && length >= 0 ? length : undefined;
}
