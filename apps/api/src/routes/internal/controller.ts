import { Elysia } from 'elysia';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { AgentDesiredStateController } from '#routes/internal/agent/desired-state/controller.ts';
import { AgentFilesystemQueryController } from '#routes/internal/agent/filesystem-query/controller.ts';
import { AgentFilesystemQueryResultController } from '#routes/internal/agent/filesystem-query-result/controller.ts';
import { AgentReportedStateController } from '#routes/internal/agent/reported-state/controller.ts';
import { AgentSessionController } from '#routes/internal/agent/session/controller.ts';

// Nothing under here is served to the internet: the public edge answers 404 for
// the whole prefix and agents reach it over the VPC instead. See the private
// listener in infra/caddy/Caddyfile.
export const InternalController = new Elysia({ prefix: RoutePrefix.Internal })
  .use(AgentSessionController)
  .use(AgentDesiredStateController)
  .use(AgentReportedStateController)
  .use(AgentFilesystemQueryController)
  .use(AgentFilesystemQueryResultController);
