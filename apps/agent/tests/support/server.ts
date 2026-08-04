import { Effect } from 'effect';

export const HTTP_OK = 200;
export const HTTP_NO_CONTENT = 204;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_SERVER_ERROR = 500;
export const HTTP_UNAVAILABLE = 503;

const ANY_PORT = 0;
const LOOPBACK = '127.0.0.1';

export type ReceivedRequest = {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
};

/** Stopped with the test's scope, so nothing that listened outlives the test that started it. */
export function serving(handler: (request: Request) => Response | Promise<Response>) {
  return Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => Bun.serve({ port: ANY_PORT, hostname: LOOPBACK, fetch: handler })),
      // Not awaited: `stop` settles only once every handler has, and a test that holds one open
      // on purpose would hang on its own teardown.
      (server) => Effect.asVoid(Effect.sync(() => server.stop(true))),
    ),
    (server) => ({ port: Number(server.url.port), baseUrl: server.url.origin }),
  );
}

/**
 * A real listener rather than a substituted `fetch`: what a client hands the network is the thing
 * under test, and the only way to read it without trusting the client's plumbing is to receive it.
 */
export function recordingServer({ body, status = HTTP_OK }: { body?: unknown; status?: number }) {
  const received: ReceivedRequest[] = [];
  return Effect.map(
    serving(async (request) => {
      received.push({
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: await request.text(),
      });
      return body === undefined ? new Response(null, { status }) : Response.json(body, { status });
    }),
    ({ baseUrl }) => ({ received, baseUrl }),
  );
}
