import { addDomain, appFor } from '@repo/app-operations';
import { z } from 'zod';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/tool.ts';

export function registerAddDomainTool({ server, api }: ToolRegistration): void {
  server.registerTool(
    'add_domain',
    {
      title: 'Add a domain',
      description:
        'Register a domain the owner brought. What comes back is not a working domain — nothing here can point their DNS at us — but the record to place that makes it one. Placing it is the proof of ownership: a certificate cannot be issued for a name that has not.',
      inputSchema: z.object({
        app: AppSlugSchema,
        hostname: z.string().describe('The domain, with no scheme and no path.'),
      }),
      outputSchema: z.object({
        hostname: z.string(),
        kind: z.string(),
        state: z.string(),
        dcvTarget: z.string().nullable(),
      }),
      annotations: { openWorldHint: true },
    },
    ({ app: slug, hostname }) =>
      answered({
        produce: async () => {
          const { app } = await appFor({ api, slug, operation: 'domains' });
          const added = await addDomain({ api, appId: app.id, hostname });
          return {
            hostname: added.hostname,
            kind: added.kind,
            state: added.state,
            dcvTarget: added.dcvTarget,
          };
        },
      }),
  );
}
