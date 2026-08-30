import { unwrap } from '@repo/api-client/unwrap';
import { servingHostname } from '@repo/app-operations';
import { z } from 'zod';
import { answered, type ToolRegistration } from '#lib/mcp/tool.ts';

export function registerListAppsTool({ server, api }: ToolRegistration): void {
  server.registerTool(
    'list_apps',
    {
      title: 'List apps',
      description:
        'Every app you own: its slug, the address it answers on, and when it last changed. The state here is the app row — what its owner asked for — not what is running. Use `get_app` for that.',
      outputSchema: z.object({
        apps: z.array(
          z.object({
            slug: z.string(),
            url: z.string(),
            state: z.string(),
            updatedAt: z.string(),
          }),
        ),
      }),
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
}
