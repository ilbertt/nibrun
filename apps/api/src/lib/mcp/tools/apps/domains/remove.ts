import { HostnameSchema, Value } from '@repo/protocol';
import { z } from 'zod';
import { appFor } from '#lib/mcp/apps.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/mcp/tool.ts';

export function registerRemoveDomainTool({ server, services, ownerId }: ToolRegistration): void {
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
          const { app } = await appFor({ services, ownerId, slug, operation: 'domains' });
          await services.hostnames.remove({
            appId: app.id,
            ownerId,
            hostname: Value.Parse(HostnameSchema, hostname),
          });
          return { hostname, detail: `${app.slug} no longer answers on ${hostname}.` };
        },
      }),
  );
}
