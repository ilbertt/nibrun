import { Elysia } from 'elysia';
import { elysiaErrorHandler } from '#lib/errors.ts';
import { requestResponsePlugin } from '#lib/request-response.ts';
import { ApiController } from '#routes/api/controller.ts';
import { RootController } from '#routes/controller.ts';
import { InternalController } from '#routes/internal/controller.ts';
import { desiredStateNewsPlugin } from '#services/plugins.ts';

export function createApp() {
  return new Elysia({ normalize: false })
    .onError(elysiaErrorHandler)
    .use(requestResponsePlugin)
    .use(desiredStateNewsPlugin)
    .use(ApiController)
    .use(InternalController)
    .use(RootController);
}
