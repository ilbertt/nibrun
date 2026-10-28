import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { hostnameOf, IP_V6, isPublicAddress } from '#lib/public-address.ts';
import { isRemoteUrl } from '#lib/remote-url.ts';

/**
 * The whole fetch rather than the connect alone: the signal stays with the body, so this is also
 * what bounds a source that answers at once and then trickles. Long enough for the largest file
 * that may be stored coming over an ordinary link, and short enough that a source which stopped
 * saying anything is a request that failed rather than one still being held.
 */
const DEFAULT_TIMEOUTS = { responseMs: 5_000, idleMs: 30_000, totalMs: 300_000 };
type Timeouts = typeof DEFAULT_TIMEOUTS;
type ResolveAddresses = (host: string) => Promise<string[] | undefined>;

/**
 * A chain no longer than the ones release hosts actually serve — an address to a store, and the
 * store to a region. Bounded because a chain that never ends is a fetch that never does.
 */
const MAX_REDIRECTS = 10;

const FIRST_REDIRECT_STATUS = 300;
const FIRST_ERROR_STATUS = 400;

/**
 * A url the api was asked to fetch a file from, opened but not read. The body is handed over as
 * a stream because a binary is the one thing here too large to hold: whoever asked for it decides
 * where the bytes go, and they go there as they arrive.
 *
 * `declaredSizeBytes` is the source's word about its own length, absent where it gave none — a
 * chunked response, or a host that does not say. It is worth having anyway: it is what lets an
 * object too large to store be refused before a byte of it is fetched.
 */
export type RemoteSource =
  | { outcome: 'open'; body: ReadableStream<Uint8Array>; declaredSizeBytes: number | undefined }
  | { outcome: 'unreachable' }
  | { outcome: 'refused'; status: number }
  | { outcome: 'empty' }
  | { outcome: 'insecure-redirect'; to: string }
  | { outcome: 'too-many-redirects' }
  | { outcome: 'private-address'; host: string };

/** Whether an address is one this will dial; see the note on the constructor argument. */
export type AddressPolicy = (address: string) => boolean;

/**
 * What a source failing part way through is raised as. Everything downstream of the fetch is this
 * process and its own store, so a read that fails is the one failure in the chain that belongs to
 * the url — and it is answered as the url's rather than as a fault of the api.
 */
export class InterruptedSourceError extends Error {
  constructor(cause: unknown) {
    super('The url stopped sending before the file was whole.', { cause });
    this.name = 'InterruptedSourceError';
  }
}

export abstract class RemoteSourceRepositoryContract {
  abstract open(input: { url: string }): Promise<RemoteSource>;
}

export class RemoteSourceRepository implements RemoteSourceRepositoryContract {
  private readonly mayDial: AddressPolicy;
  private readonly resolveAddresses: ResolveAddresses;
  private readonly timeouts: Timeouts;

  /**
   * Which addresses this will dial, defaulting to the only answer production has any business
   * using. It is an argument at all so that a test can point one of these at a server on the
   * machine running it — which is, by definition, an address the default refuses.
   */
  constructor({
    mayDial = isPublicAddress,
    resolveAddresses = addressesOf,
    timeouts,
  }: {
    mayDial?: AddressPolicy;
    resolveAddresses?: ResolveAddresses;
    timeouts?: Partial<Timeouts>;
  } = {}) {
    this.mayDial = mayDial;
    this.resolveAddresses = resolveAddresses;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  }

  /**
   * Redirects are followed a hop at a time rather than by `fetch` itself, which is what makes both
   * rules mean anything: every store that hosts a release answers the address people share with a
   * redirect, and a rule applied to the first address alone is one a `302` walks straight around.
   */
  async open({ url }: { url: string }): Promise<RemoteSource> {
    const deadline = AbortSignal.timeout(this.timeouts.totalMs);
    let target = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const reached = await this.reach({ url: target, deadline });
      if (reached.outcome !== 'answered') {
        return reached;
      }
      const location = redirectTarget({ response: reached.response, from: target });
      if (location === undefined) {
        return await answered({
          response: reached.response,
          deadline,
          idleMs: this.timeouts.idleMs,
        });
      }
      await discard(reached.response);
      if (!isRemoteUrl(location)) {
        return { outcome: 'insecure-redirect', to: location };
      }
      target = location;
    }

    return { outcome: 'too-many-redirects' };
  }

  /**
   * One hop, judged before it is dialled and then held to what was judged.
   *
   * Resolving to decide and resolving again to connect are two separate answers, and a name that
   * gives a different one the second time is the whole of how a check on the first is walked
   * around — so the address that passed is the address dialled, with the name carried in the
   * handshake and in `Host` so the certificate is still checked against it.
   */
  private async reach({ url, deadline }: { url: string; deadline: AbortSignal }): Promise<Reached> {
    const parsed = parse(url);
    if (parsed === undefined) {
      return { outcome: 'unreachable' };
    }
    const host = hostnameOf(parsed);
    const addresses = await beforeTimeout({
      run: () => this.resolveAddresses(host),
      deadline,
      timeoutMs: this.timeouts.responseMs,
    }).catch(() => undefined);
    if (addresses === undefined) {
      return { outcome: 'unreachable' };
    }
    // Every one of them: a name answering with an address anyone can reach and one only this box
    // can is a name that would otherwise be judged on whichever happened to come first.
    if (!addresses.every(this.mayDial)) {
      return { outcome: 'private-address', host };
    }

    for (const address of addresses) {
      if (deadline.aborted) {
        break;
      }
      const response = await get({
        url: parsed,
        address,
        deadline,
        timeoutMs: this.timeouts.responseMs,
      });
      if (response !== undefined) {
        return { outcome: 'answered', response };
      }
    }
    return { outcome: 'unreachable' };
  }
}

type Reached =
  | { outcome: 'answered'; response: Response }
  | { outcome: 'unreachable' }
  | { outcome: 'private-address'; host: string };

/**
 * Every address the name answers with, or the literal it already is.
 *
 * A url that already names an address has nothing to look up and nothing to be held to that it
 * does not already say, so it is its own answer.
 */
async function addressesOf(host: string): Promise<string[] | undefined> {
  if (isIP(host) !== 0) {
    return [host];
  }
  try {
    const found = await lookup(host, { all: true });
    return found.length === 0 ? undefined : found.map((each) => each.address);
  } catch {
    return undefined;
  }
}

/**
 * A url that answers nothing is the ordinary failure here rather than a fault of this api: it was
 * typed by whoever wrote the link, and only they can fix it. Undefined rather than the error,
 * because what went wrong at the socket is not something to read back to them.
 */
async function get({
  url,
  address,
  deadline,
  timeoutMs,
}: {
  url: URL;
  address: string;
  deadline: AbortSignal;
  timeoutMs: number;
}): Promise<Response | undefined> {
  const request: BunFetchRequestInit = { redirect: 'manual', proxy: false };
  const dialled = pinnedTo({ url, address });
  if (dialled.hostname !== url.hostname) {
    request.headers = { host: url.host };
    request.tls = { serverName: url.hostname };
  }
  try {
    return await beforeTimeout({
      run: (signal) => fetch(dialled, { ...request, signal }),
      deadline,
      timeoutMs,
    });
  } catch {
    return undefined;
  }
}

async function beforeTimeout<T>({
  run,
  deadline,
  timeoutMs,
}: {
  run: (signal: AbortSignal) => Promise<T>;
  deadline: AbortSignal;
  timeoutMs: number;
}): Promise<T> {
  const controller = new AbortController();
  const signal = AbortSignal.any([deadline, controller.signal]);
  const timer = setTimeout(() => controller.abort(new Error('The source timed out.')), timeoutMs);
  const interrupted = Promise.withResolvers<never>();
  function abort() {
    interrupted.reject(signal.reason);
  }
  try {
    signal.throwIfAborted();
    signal.addEventListener('abort', abort, { once: true });
    return await Promise.race([run(signal), interrupted.promise]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function pinnedTo({ url, address }: { url: URL; address: string }): URL {
  const dialled = new URL(url);
  dialled.hostname = isIP(address) === IP_V6 ? `[${address}]` : address;
  return dialled;
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

async function answered({
  response,
  deadline,
  idleMs,
}: {
  response: Response;
  deadline: AbortSignal;
  idleMs: number;
}): Promise<RemoteSource> {
  if (!response.ok) {
    await discard(response);
    return { outcome: 'refused', status: response.status };
  }
  if (response.body === null) {
    return { outcome: 'empty' };
  }
  return {
    outcome: 'open',
    body: saidAsTheSource({ body: response.body, deadline, idleMs }),
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
function saidAsTheSource({
  body,
  deadline,
  idleMs,
}: {
  body: ReadableStream<Uint8Array>;
  deadline: AbortSignal;
  idleMs: number;
}): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await beforeTimeout({
          run: () => reader.read(),
          deadline,
          timeoutMs: idleMs,
        });
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (failure) {
        controller.error(new InterruptedSourceError(failure));
        void reader.cancel(failure).catch(() => undefined);
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
