import { appFor, removeDomain } from '@repo/app-operations';
import { z } from 'zod';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/tool.ts';

export function registerRemoveDomainTool({ server, api }: ToolRegistration): void {
  server.registerTool(
    'remove_domain',
    {
      title: 'Remove a domain',
      description:
        'Stop serving a domain the owner brought. The app keeps answering on the hostname nibrun issued it.',
      inputSchema: z.object({
        app: AppSlugSchema,
        hostname: z.string().describe('The domain, with no scheme and no path.'),
      }),
      outputSchema: z.object({ hostname: z.string(), detail: z.string() }),
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ app: slug, hostname }) =>
      answered({
        produce: async () => {
          const { app } = await appFor({ api, slug, operation: 'domains' });
          await removeDomain({ api, appId: app.id, hostname });
          return { hostname, detail: `${app.slug} no longer answers on ${hostname}.` };
        },
      }),
  );
}
