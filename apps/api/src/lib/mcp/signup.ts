import { MCP_RESOURCE, MCP_SCOPE } from '#lib/mcp/auth.ts';

export function isMcpAuthorizationQuery(query: unknown): boolean {
  if (typeof query !== 'string') {
    return false;
  }
  const params = new URLSearchParams(query);
  return (
    params.getAll('resource').includes(MCP_RESOURCE.href) &&
    (params.get('scope') ?? '').split(/\s+/).includes(MCP_SCOPE)
  );
}
