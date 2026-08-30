import { z } from 'zod';
import { appFor } from '#lib/mcp/apps.ts';
import {
  AppSlugSchema,
  AppTransitionResultSchema,
  answered,
  type ToolRegistration,
} from '#lib/mcp/tool.ts';

const KEPT =
  'Its microVM stops; the volume, everything on it and every hostname stay. `resume_app` puts it back.';

export function registerSuspendAppTool({ server, services, ownerId }: ToolRegistration): void {
  server.registerTool(
    'suspend_app',
    {
      title: 'Suspend an app',
      description: `Take the app offline without giving anything of it up. ${KEPT}`,
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: AppTransitionResultSchema,
      annotations: { idempotentHint: true, openWorldHint: true },
    },
    ({ app: slug }) =>
      answered({
        produce: async () => {
          const { app } = await appFor({ services, ownerId, slug, operation: 'suspend' });
          if (app.state === 'suspended') {
            return {
              slug: app.slug,
              state: app.state,
              detail: `${app.slug} is already suspended.`,
            };
          }
          const suspended = await services.apps.setState({
            appId: app.id,
            ownerId,
            state: 'suspended',
          });
          return {
            slug: suspended.slug,
            state: suspended.state,
            detail: `${suspended.slug} is suspended. ${KEPT}`,
          };
        },
      }),
  );
}
