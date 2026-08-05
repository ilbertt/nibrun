import { AGENT_API_PREFIX, type AGENT_ROUTES } from '@repo/protocol';
import { pathBelow, RoutePrefix } from '#lib/routes/prefixes.ts';

type AgentRoute = (typeof AGENT_ROUTES)[keyof typeof AGENT_ROUTES];

// The protocol owns the whole path, so it is cut down here rather than spelled out again beside
// a handler: the two cannot drift when only one of them is written.
export function agentRoutePath<Route extends AgentRoute>(route: Route) {
  return pathBelow({ path: `${AGENT_API_PREFIX}${route}`, prefix: RoutePrefix.Internal });
}
