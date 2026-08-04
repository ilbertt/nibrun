import { Elysia } from 'elysia';
import { elysiaErrorHandler } from '#lib/errors.ts';
import { requestResponsePlugin } from '#lib/request-response.ts';
import { ApiController } from '#routes/api/controller.ts';
import { RootController } from '#routes/controller.ts';
import { InternalController } from '#routes/internal/controller.ts';

export function createApp() {
  return new Elysia()
    .onError(elysiaErrorHandler)
    .use(requestResponsePlugin)
    .use(ApiController)
    .use(InternalController)
    .use(RootController);
}
