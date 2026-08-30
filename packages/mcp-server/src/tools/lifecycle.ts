import { appFor, deleteApp, resumeApp, suspendApp } from '@repo/app-operations';
import { z } from 'zod';
import { AppSlugSchema, answered, type ToolRegistration } from '#tool.ts';

const TransitionResultSchema = z.object({
  slug: z.string(),
  state: z.string(),
  detail: z.string(),
});

const SUSPENDED =
  'Its microVM stops; the volume, everything on it and every hostname stay. `resume_app` puts it back.';

export function registerLifecycleTools({ server, api }: ToolRegistration): void {
  server.registerTool(
    'suspend_app',
    {
      title: 'Suspend an app',
      description: `Take the app offline without giving anything of it up. ${SUSPENDED}`,
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: TransitionResultSchema,
      annotations: { idempotentHint: true, openWorldHint: true },
    },
    ({ app: slug }) =>
      answered({
        produce: async () => {
          const { app } = await appFor({ api, slug, operation: 'suspend' });
          if (app.state === 'suspended') {
            return {
              slug: app.slug,
              state: app.state,
              detail: `${app.slug} is already suspended.`,
            };
          }
          const suspended = await suspendApp({ api, appId: app.id });
          return {
            slug: suspended.slug,
            state: suspended.state,
            detail: `${suspended.slug} is suspended. ${SUSPENDED}`,
          };
        },
      }),
  );

  server.registerTool(
    'resume_app',
    {
      title: 'Resume an app',
      description:
        'Bring a suspended app back. The host boots the deployment it was suspended on, onto the same volume.',
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: TransitionResultSchema,
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

  server.registerTool(
    'delete_app',
    {
      title: 'Delete an app',
      description:
        'Delete the app, the hostnames it answered on, everything its binary ever wrote, and every deployment, binary and export of it. Nothing here is recoverable — take an export first if any of the volume is worth keeping.',
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: TransitionResultSchema,
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    ({ app: slug }) =>
      answered({
        produce: async () => {
          const { app } = await appFor({ api, slug, operation: 'delete' });
          const deleted = await deleteApp({ api, appId: app.id });
          return {
            slug: deleted.slug,
            state: deleted.state,
            detail: `${deleted.slug} is being deleted. Its hostnames stop answering and its volume is gone.`,
          };
        },
      }),
  );
}
