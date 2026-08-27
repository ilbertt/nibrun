import { Elysia, StatusMap } from 'elysia';
import { GetHealthResponseSchema } from '#routes/api/health/model.ts';
import { HealthServicePlugin, loggerPlugin } from '#services/plugins.ts';

/**
 * Always OK while this process is answering, whatever it reports below itself. The container's
 * own healthcheck calls this route and the deploy gates on that healthcheck, so a status carrying
 * the fleet's verdict would fail a release for a log store nobody deployed — and would fail every
 * release outright, since a freshly started api has heard from no host yet.
 *
 * A refusal would not reach a reader anyway: the edge replaces an origin 5xx with a page of its
 * own, so the breakdown is only ever readable in a body that came back 200.
 */
export const HealthController = new Elysia()
  .use(loggerPlugin('healthController'))
  .use(HealthServicePlugin)
  .get(
    '/health',
    async ({ healthService, status }) => {
      const result = await healthService.check();
      return status(StatusMap.OK, result);
    },
    {
      response: {
        [StatusMap.OK]: GetHealthResponseSchema,
      },
    },
  );
