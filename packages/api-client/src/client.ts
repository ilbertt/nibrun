import { type Treaty, treaty } from '@elysiajs/eden';

// Eden's own constraint, read back off it rather than imported: `elysia` reaches this package
// only as Eden's peer, so naming it here would be a dependency taken for one type.
type AnyApp = Exclude<Parameters<typeof treaty>[0], string>;

/**
 * `headers` are sent on every request. A browser has a cookie and needs none; anything without
 * one — a CLI, a script — carries its credential here rather than repeating it per call.
 */
export type ApiClientOptions = {
  baseUrl: string;
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
