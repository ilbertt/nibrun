import { appFor, resumeApp } from '@repo/app-operations';
import { z } from 'zod';
import {
  AppSlugSchema,
  AppTransitionResultSchema,
  answered,
  type ToolRegistration,
} from '#lib/mcp/tool.ts';

export function registerResumeAppTool({ server, api }: ToolRegistration): void {
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
          const { app } = await appFor({ api, slug, operation: 'resume' });
          if (app.state === 'active') {
            return { slug: app.slug, state: app.state, detail: `${app.slug} is already running.` };
          }
          const resumed = await resumeApp({ api, appId: app.id });
          return {
            slug: resumed.slug,
            state: resumed.state,
            detail: `${resumed.slug} is active. The host boots the deployment it was suspended on.`,
          };
        },
      }),
  );
}
