import type { HttpPort, Ipv4Address } from '@repo/protocol';
import { Data, Duration, Effect } from 'effect';

/**
 * How long the guest has to begin answering. The answer itself is not under it: what comes back
 * is streamed on to whoever asked, and a download or an event stream takes as long as the tenant
 * takes. What is bounded is a guest that accepted the connection and then said nothing — `fetch`
 * has no deadline of its own, so without this the visitor waits on it forever and so does the
 * proxy connection they are holding.
 *
 * Long, because this is the one request that found no microVM: everything the tenant does lazily
 * on its first request happens under it, and answering a working app with an error page is worse
 * than the wait.
 */
const ANSWER_TIMEOUT = Duration.seconds(60);

export class GuestDidNotAnswer extends Data.TaggedError('GuestDidNotAnswer')<{
  readonly guestIpv4: Ipv4Address;
  readonly httpPort: HttpPort;
}> {
  override get message() {
    return `${this.guestIpv4}:${this.httpPort} took the request that woke it and did not answer within ${Duration.toSeconds(ANSWER_TIMEOUT)}s`;
  }
}

/**
 * Headers describing one hop of a connection rather than the message travelling on it. Copying
 * them onto the next hop is how a proxy tells a client about a connection it does not have.
 */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

/**
 * Dropped on the way out, which is what makes the way back simple: an origin asked for identity
 * answers in it, so nothing here has to reason about a body `fetch` has already decoded while
 * the header describing it says otherwise.
 */
const ENCODING_REQUEST_HEADERS = ['accept-encoding'];

/** Both describe bytes this end reframes, so both are the previous hop's to state, not ours. */
const ENCODING_RESPONSE_HEADERS = ['content-encoding', 'content-length'];

function without({ headers, drop }: { headers: Headers; drop: readonly string[] }): Headers {
  const kept = new Headers(headers);
  for (const name of [...HOP_BY_HOP, ...drop]) {
    kept.delete(name);
  }
  return kept;
}

/**
 * Hands one request to a guest and its answer back, for the single request that had to wait for
 * the microVM it woke. Every request after it reaches the guest through the forward rule instead
 * — this end is not in the path once the app is up, and `connection: close` is what makes sure
 * of that: the proxy pools its upstream connections, and one it keeps open to here would go on
 * being answered here long after the rule that should have taken it over was in the kernel.
 */
export const forwardToGuest = Effect.fn('forwardToGuest')(
  ({
    request,
    guestIpv4,
    httpPort,
  }: {
    request: Request;
    guestIpv4: Ipv4Address;
    httpPort: HttpPort;
  }) =>
    Effect.tryPromise(async (signal) => {
      const target = new URL(request.url);
      target.protocol = 'http:';
      target.hostname = guestIpv4;
      target.port = String(httpPort);

      const upstream = await fetch(target, {
        method: request.method,
        headers: without({ headers: request.headers, drop: ENCODING_REQUEST_HEADERS }),
        body: request.body,
        redirect: 'manual',
        duplex: 'half',
        // Giving up here has to reach the socket too, or the guest goes on being asked for an
        // answer nobody is waiting for and the connection to it is never released.
        signal,
      } as RequestInit);

      const headers = without({
        headers: upstream.headers,
        drop: ENCODING_RESPONSE_HEADERS,
      });
      headers.set('connection', 'close');
      return new Response(upstream.body, { status: upstream.status, headers });
    }).pipe(
      Effect.timeoutFail({
        duration: ANSWER_TIMEOUT,
        onTimeout: () => new GuestDidNotAnswer({ guestIpv4, httpPort }),
      }),
    ),
);
