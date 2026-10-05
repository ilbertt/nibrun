import { Elysia, StatusMap } from 'elysia';
import { publicSchema } from '#lib/api/public-schema.ts';
import { ConfigurationResponseSchema } from '#routes/api/configuration/model.ts';
import { ConfigurationServicePlugin } from '#services/plugins.ts';

export const ConfigurationController = new Elysia().use(ConfigurationServicePlugin).get(
  '/configuration',
  ({ configurationService, set }) => {
    set.headers['access-control-allow-origin'] = '*';
    return configurationService.get();
  },
  {
    response: { [StatusMap.OK]: publicSchema(ConfigurationResponseSchema) },
  },
);
