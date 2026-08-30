import { Elysia } from 'elysia';
import { elysiaErrorHandler } from '#lib/errors.ts';
import { requestResponsePlugin } from '#lib/request-response.ts';
import { ApiController } from '#routes/api/controller.ts';
import { RootController } from '#routes/controller.ts';
import { InternalController } from '#routes/internal/controller.ts';
import { McpController } from '#routes/mcp/controller.ts';
import { mcpService } from '#services/plugins.ts';

export function createApp() {
  const app = new Elysia({ normalize: false })
    .onError(elysiaErrorHandler)
    .use(requestResponsePlugin)
    .use(ApiController)
    .use(InternalController)
    .use(McpController)
    .use(RootController);

  // The mcp tools reach the api through the very server they are mounted on, which is why it is
  // handed over here rather than injected: neither exists without the other until this line.
  mcpService.serves(app);

  return app;
}
