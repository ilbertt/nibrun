export enum RoutePrefix {
  // Must reflect the routes dir layout
  Root = '/',
  Api = '/api',
  // Answered by the edge with 404 and reached by agents over the VPC, so a
  // route added here is unreachable from the internet the moment it is written.
  Internal = '/internal',
  // The MCP endpoint.
  Mcp = '/mcp',
}

type PathBelow<
  Path extends string,
  Prefix extends RoutePrefix,
> = Path extends `${Prefix}${infer Below}` ? Below : never;

/**
 * What a controller is left to mount once the prefix its parent already applied is taken off a
 * full path. `never` when the path does not sit under that prefix at all.
 *
 * A function rather than a cast at each call site, because the two halves have to agree: `slice`
 * returns `string`, and Elysia builds its route tree from a literal, so the prefix has to be
 * named again in a type to get one back. Named once here, the length taken off and the prefix
 * asserted cannot be different prefixes.
 */
export function pathBelow<Path extends string, Prefix extends RoutePrefix>({
  path,
  prefix,
}: {
  path: Path;
  prefix: Prefix;
}): PathBelow<Path, Prefix> {
  return path.slice(prefix.length) as PathBelow<Path, Prefix>;
}
