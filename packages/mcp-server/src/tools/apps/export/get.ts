import { unwrap } from '@repo/api-client/unwrap';
import { appFor } from '@repo/app-operations';
import { z } from 'zod';
import { ExportResultSchema } from '#lib/export.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/tool.ts';

export function registerGetExportTool({ server, api }: ToolRegistration): void {
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
          const { app } = await appFor({ api, slug, operation: 'export' });
          const found = unwrap(await api.api.apps({ appId: app.id }).exports({ exportId }).get());
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
