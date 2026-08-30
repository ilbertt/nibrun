import { addDomain, appFor, removeDomain } from '@repo/app-operations';
import { z } from 'zod';
import { AppSlugSchema, answered, type ToolRegistration } from '#tool.ts';

const HostnameSchema = z.string().describe('The domain, with no scheme and no path.');

export function registerDomainTools({ server, api }: ToolRegistration): void {
  server.registerTool(
    'add_domain',
    {
      title: 'Add a domain',
      description:
        'Register a domain the owner brought. What comes back is not a working domain — nothing here can point their DNS at us — but the record to place that makes it one. Placing it is the proof of ownership: a certificate cannot be issued for a name that has not.',
      inputSchema: z.object({ app: AppSlugSchema, hostname: HostnameSchema }),
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

  server.registerTool(
    'remove_domain',
    {
      title: 'Remove a domain',
      description:
        'Stop serving a domain the owner brought. The app keeps answering on the hostname nibrun issued it.',
      inputSchema: z.object({ app: AppSlugSchema, hostname: HostnameSchema }),
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
