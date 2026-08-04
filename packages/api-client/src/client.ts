import { type Treaty, treaty } from '@elysiajs/eden';

// Eden's own constraint, read back off it rather than imported: `elysia` reaches this package
// only as Eden's peer, so naming it here would be a dependency taken for one type.
type AnyApp = Exclude<Parameters<typeof treaty>[0], string>;

// Every surface is built here rather than each one calling Eden with the same options, so a
// surface added later cannot be the one that forgets them.
//
// `parseDate` is off because Eden otherwise revives anything ISO-8601-shaped into a Date on the
// way in. Timestamps are strings everywhere the api declares them, so leaving it on hands a
// caller a value that disagrees with the type it was just given, and every schema that
// revalidates one rejects it.
export function createClient<App extends AnyApp>({
  baseUrl,
}: {
  baseUrl: string;
}): Treaty.Create<App> {
  return treaty<App>(baseUrl, { parseDate: false });
}
