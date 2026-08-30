import { APP_STATUS_LABELS, servingHostname, statusKey } from '@repo/app-operations';
import { z } from 'zod';
import { appWithStatus } from '#lib/mcp/apps.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/mcp/tool.ts';

export function registerGetAppTool({ server, services, ownerId }: ToolRegistration): void {
  server.registerTool(
    'get_app',
    {
      title: 'Get an app',
      description:
        'One app in full: what it is doing now, how its binary is started, the hostnames it answers on, and the release it is on. A release that failed carries the host account of why.',
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: z.object({
        slug: z.string(),
        url: z.string(),
        status: z.string(),
        args: z.array(z.string()),
        httpPort: z.number(),
        hasExtraPublicPort: z.boolean(),
        environmentNames: z.array(z.string()),
        hostnames: z.array(z.object({ hostname: z.string(), kind: z.string(), state: z.string() })),
        deployment: z
          .object({
            id: z.string(),
            state: z.string(),
            createdAt: z.string(),
            message: z.string().optional(),
          })
          .nullable(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ app: slug }) =>
      answered({
        produce: async () => {
          const { app, newest, status } = await appWithStatus({ services, ownerId, slug });
          return {
            slug: app.slug,
            url: `https://${servingHostname(app.hostnames)}`,
            status: APP_STATUS_LABELS[statusKey(status)],
            args: app.config.args,
            httpPort: app.config.httpPort,
            hasExtraPublicPort: app.config.hasExtraPublicPort,
            // Names only. The values are sealed on their way to the host and read back redacted,
            // so there is nothing here that could return one.
            environmentNames: Object.keys(app.config.environment),
            hostnames: app.hostnames.map(({ hostname, kind, state }) => ({
              hostname,
              kind,
              state,
            })),
            deployment: newest
              ? {
                  id: newest.id,
                  state: newest.state,
                  createdAt: newest.createdAt,
                  ...(newest.message !== undefined && { message: newest.message }),
                }
              : null,
          };
        },
      }),
  );
}
