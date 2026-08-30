import { unwrap } from '@repo/api-client/unwrap';
import { APP_STATUS_LABELS, appWithStatus, servingHostname, statusKey } from '@repo/app-operations';
import { z } from 'zod';
import { AppSlugSchema, answered, type ToolRegistration } from '#tool.ts';

const AppSummarySchema = z.object({
  slug: z.string(),
  url: z.string(),
  state: z.string(),
  updatedAt: z.string(),
});

const ListAppsResultSchema = z.object({ apps: z.array(AppSummarySchema) });

const GetAppResultSchema = z.object({
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
});

export function registerAppTools({ server, api }: ToolRegistration): void {
  server.registerTool(
    'list_apps',
    {
      title: 'List apps',
      description:
        'Every app you own: its slug, the address it answers on, and when it last changed. The state here is the app row — what its owner asked for — not what is running. Use `get_app` for that.',
      outputSchema: ListAppsResultSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () =>
      answered({
        produce: async () => {
          // The row's own state rather than each app's status: a status is the app read against
          // its newest release, and asking for one per app turns a listing into two requests an
          // app. What a reader wants from a list is which app to look at.
          const { apps } = unwrap(await api.api.apps.get());
          return {
            apps: apps.map((app) => ({
              slug: app.slug,
              url: `https://${servingHostname(app.hostnames)}`,
              state: app.state,
              updatedAt: app.updatedAt,
            })),
          };
        },
      }),
  );

  server.registerTool(
    'get_app',
    {
      title: 'Get an app',
      description:
        'One app in full: what it is doing now, how its binary is started, the hostnames it answers on, and the release it is on. A release that failed carries the host account of why.',
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: GetAppResultSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ app: slug }) =>
      answered({
        produce: async () => {
          const { app, newest, status } = await appWithStatus({ api, slug });
          return {
            slug: app.slug,
            url: `https://${servingHostname(app.hostnames)}`,
            status: APP_STATUS_LABELS[statusKey(status)],
            args: app.config.args,
            httpPort: app.config.httpPort,
            hasExtraPublicPort: app.config.hasExtraPublicPort,
            // Names only. The values are sealed on their way to the host and the api answers
            // every one of them redacted, so there is nothing here that could return one.
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
