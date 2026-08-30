import { type Treaty, treaty } from '@elysiajs/eden';

// Eden's own constraint, read back off it rather than imported: `elysia` reaches this package
// only as Eden's peer, so naming it here would be a dependency taken for one type.
type AnyApp = Exclude<Parameters<typeof treaty>[0], string>;

/**
 * `headers` are sent on every request. A browser has a cookie and needs none; anything without
 * one — a CLI, a script, a tool acting for whoever called it — carries its credential here rather
 * than repeating it per call.
 */
export type ApiClientOptions = {
  baseUrl: string;
  headers?: Record<string, string>;
};

/**
 * The same api, reached by a caller already inside it.
 *
 * Eden dispatches an instance through `app.handle` rather than over a socket, so nothing is
 * serialised onto the network and nothing leaves the process — while every plugin the route has
 * still runs, which is what holds such a caller to the same authorization as one that arrived
 * from outside. Anything else would be a second way in.
 */
export type InProcessApiClientOptions = {
  app: AnyApp;
  headers?: Record<string, string>;
};

// Every surface is built here rather than each one calling Eden with the same options, so a
// surface added later cannot be the one that forgets them.
//
// `parseDate` is off because Eden otherwise revives anything ISO-8601-shaped into a Date on the
// way in. Timestamps are strings everywhere the api declares them, so leaving it on hands a
// caller a value that disagrees with the type it was just given, and every schema that
// revalidates one rejects it.
export function createClient<App extends AnyApp>({
  baseUrl,
  headers,
}: ApiClientOptions): Treaty.Create<App> {
  return treaty<App>(baseUrl, { parseDate: false, headers });
}

export function createInProcessClient<App extends AnyApp>({
  app,
  headers,
}: InProcessApiClientOptions): Treaty.Create<App> {
  // The instance is only ever wider than the routes `App` describes — the whole server rather than
  // the controller the type is taken from — because that is the one that carries the error handler
  // every route's refusals are shaped by. Eden reads the instance for dispatch and the type for the
  // surface, so the two agree wherever the server actually mounts that controller.
  return treaty<App>(app as never, { parseDate: false, headers });
}
