import { ExportIdSchema, Value } from '@repo/protocol';
import { z } from 'zod';
import { appFor } from '#lib/mcp/apps.ts';
import { ExportResultSchema } from '#lib/mcp/export.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/mcp/tool.ts';

export function registerGetExportTool({ server, services, ownerId }: ToolRegistration): void {
  server.registerTool(
    'get_export',
    {
      title: 'Check an export',
      description:
        'Whether the bundle is written yet. A download url rather than a state is what says it is: the url is signed and outlives the answer it arrives in by minutes, so read it when it appears rather than reading `state`.',
      inputSchema: z.object({ app: AppSlugSchema, exportId: z.string() }),
      outputSchema: ExportResultSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ app: slug, exportId }) =>
      answered({
        produce: async () => {
          const { app } = await appFor({ services, ownerId, slug, operation: 'export' });
          const found = await services.exports.get({
            appId: app.id,
            ownerId,
            exportId: Value.Parse(ExportIdSchema, exportId),
          });
          return {
            exportId: found.id,
            state: found.state,
            ...(found.downloadUrl !== undefined && { downloadUrl: found.downloadUrl }),
            ...(found.sizeBytes !== undefined && { sizeBytes: found.sizeBytes }),
            detail:
              found.downloadUrl === undefined
                ? `Export ${found.id} is ${found.state}.`
                : `Export ${found.id} is ready to download.`,
          };
        },
      }),
  );
}
