import { Effect } from 'effect';

export type ReceivedCall = {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
};

const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;

export function servingFirecracker({
  socketPath,
  configuration,
  fault,
}: {
  socketPath: string;
  configuration: unknown;
  fault: string | undefined;
}) {
  const received: ReceivedCall[] = [];
  return Effect.as(
    Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          unix: socketPath,
          fetch: async (request) => {
            received.push({
              method: request.method,
              path: new URL(request.url).pathname,
              body: request.method === 'GET' ? undefined : await request.json(),
            });
            if (fault !== undefined) {
              return Response.json({ fault_message: fault }, { status: HTTP_BAD_REQUEST });
            }
            return request.method === 'GET'
              ? Response.json(configuration)
              : new Response(null, { status: HTTP_NO_CONTENT });
          },
        }),
      ),
      (server) => Effect.asVoid(Effect.sync(() => server.stop(true))),
    ),
    received,
  );
}
