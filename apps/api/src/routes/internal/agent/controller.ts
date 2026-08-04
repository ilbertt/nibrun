import { AGENT_API_PREFIX } from '@repo/protocol';
import { Elysia } from 'elysia';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { AgentDesiredStateController } from '#routes/internal/agent/desired-state/controller.ts';
import { AgentReportedStateController } from '#routes/internal/agent/reported-state/controller.ts';
import { AgentSessionController } from '#routes/internal/agent/session/controller.ts';
import { AgentTenantLogsController } from '#routes/internal/agent/tenant-logs/controller.ts';

type PathBelow<Path extends string, Prefix extends string> = Path extends `${Prefix}${infer Below}`
  ? Below
  : never;

// The protocol owns the whole path. This controller applies only the segment below
// the prefix its parent applies, derived from that one constant so the two cannot
// drift, and its children keep the bare paths the protocol names.
//
// The cast restores what `slice` widens away. A literal is what Elysia builds the route
// tree from, so without it every path under here is an index signature: the generated
// client would answer to a segment this controller never mounted. `PathBelow` resolves to
// `never` if the protocol ever stops naming a path under this prefix, which is the drift
// the derivation exists to catch.
const AGENT_PREFIX = AGENT_API_PREFIX.slice(RoutePrefix.Internal.length) as PathBelow<
  typeof AGENT_API_PREFIX,
  RoutePrefix.Internal
>;

export const AgentController = new Elysia({ prefix: AGENT_PREFIX })
  .use(AgentSessionController)
  .use(AgentDesiredStateController)
  .use(AgentReportedStateController)
  .use(AgentTenantLogsController);
