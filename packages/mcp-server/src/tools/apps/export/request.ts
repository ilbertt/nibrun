import { appFor, requestExport } from '@repo/app-operations';
import { z } from 'zod';
import { ExportResultSchema } from '#lib/export.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/tool.ts';

export function registerExportAppTool({ server, api }: ToolRegistration): void {
  server.registerTool(
    'export_app',
    {
      title: 'Request an export',
      description:
        'Ask for a bundle of everything on the app volume. The host allows itself an hour to read one filesystem, so this returns as soon as the request is in — poll `get_export` for the download url.',
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: ExportResultSchema,
      annotations: { openWorldHint: true },
    },
    ({ app: slug }) =>
      answered({
        produce: async () => {
          const { app } = await appFor({ api, slug, operation: 'export' });
          const requested = await requestExport({ api, appId: app.id });
          return {
            exportId: requested.id,
            state: requested.state,
            detail: `Export ${requested.id} of ${app.slug} is ${requested.state}. Poll get_export for the download url.`,
          };
        },
      }),
  );
}
