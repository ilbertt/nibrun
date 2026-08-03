import { Elysia } from 'elysia';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { AgentController } from '#routes/internal/agent/controller.ts';

// Nothing under here is served to the internet: the public edge answers 404 for
// the whole prefix and agents reach it over the VPC instead. See the private
// listener in infra/caddy/Caddyfile.
export const InternalController = new Elysia({ prefix: RoutePrefix.Internal }).use(AgentController);
