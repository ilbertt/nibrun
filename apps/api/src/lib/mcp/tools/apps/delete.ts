import { z } from 'zod';
import { appFor } from '#lib/mcp/apps.ts';
import {
  AppSlugSchema,
  AppTransitionResultSchema,
  answered,
  type ToolRegistration,
} from '#lib/mcp/tool.ts';

export function registerDeleteAppTool({ server, services, ownerId }: ToolRegistration): void {
  server.registerTool(
    'delete_app',
    {
      title: 'Delete an app',
      description:
        'Delete the app, the hostnames it answered on, everything its binary ever wrote, and every deployment, binary and export of it. Nothing here is recoverable — take an export first if any of the volume is worth keeping.',
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: AppTransitionResultSchema,
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    ({ app: slug }) =>
      answered({
        produce: async () => {
          const { app } = await appFor({ services, ownerId, slug, operation: 'delete' });
          const deleted = await services.apps.delete({ appId: app.id, ownerId });
          return {
            slug: deleted.slug,
            state: deleted.state,
            detail: `${deleted.slug} is being deleted. Its hostnames stop answering and its volume is gone.`,
          };
        },
      }),
  );
}
