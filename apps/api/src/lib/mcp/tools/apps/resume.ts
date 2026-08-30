import { z } from 'zod';
import { appFor } from '#lib/mcp/apps.ts';
import {
  AppSlugSchema,
  AppTransitionResultSchema,
  answered,
  type ToolRegistration,
} from '#lib/mcp/tool.ts';

export function registerResumeAppTool({ server, services, ownerId }: ToolRegistration): void {
  server.registerTool(
    'resume_app',
    {
      title: 'Resume an app',
      description:
        'Bring a suspended app back. The host boots the deployment it was suspended on, onto the same volume.',
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: AppTransitionResultSchema,
      annotations: { idempotentHint: true, openWorldHint: true },
    },
    ({ app: slug }) =>
      answered({
        produce: async () => {
          const { app } = await appFor({ services, ownerId, slug, operation: 'resume' });
          if (app.state === 'active') {
            return { slug: app.slug, state: app.state, detail: `${app.slug} is already running.` };
          }
          const resumed = await services.apps.setState({ appId: app.id, ownerId, state: 'active' });
          return {
            slug: resumed.slug,
            state: resumed.state,
            detail: `${resumed.slug} is active. The host boots the deployment it was suspended on.`,
          };
        },
      }),
  );
}
