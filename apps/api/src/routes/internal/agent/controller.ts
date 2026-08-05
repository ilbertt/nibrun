import { AGENT_API_PREFIX } from '@repo/protocol';
import { Elysia } from 'elysia';
import { pathBelow, RoutePrefix } from '#lib/routes/prefixes.ts';
import { AgentDesiredStateController } from '#routes/internal/agent/desired-state/controller.ts';
import { AgentFilesystemQueryController } from '#routes/internal/agent/filesystem-query/controller.ts';
import { AgentFilesystemQueryResultController } from '#routes/internal/agent/filesystem-query-result/controller.ts';
import { AgentReportedStateController } from '#routes/internal/agent/reported-state/controller.ts';
import { AgentSessionController } from '#routes/internal/agent/session/controller.ts';

// The protocol owns the whole path. This controller applies only the segment below
// the prefix its parent applies, derived from that one constant so the two cannot
// drift, and its children keep the bare paths the protocol names.
const AGENT_PREFIX = pathBelow({ path: AGENT_API_PREFIX, prefix: RoutePrefix.Internal });

export const AgentController = new Elysia({ prefix: AGENT_PREFIX })
  .use(AgentSessionController)
  .use(AgentDesiredStateController)
  .use(AgentReportedStateController)
  .use(AgentFilesystemQueryController)
  .use(AgentFilesystemQueryResultController);
