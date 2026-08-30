import { unwrap } from '@repo/api-client/unwrap';
import { appFor, requestExport } from '@repo/app-operations';
import { z } from 'zod';
import { AppSlugSchema, answered, type ToolRegistration } from '#tool.ts';

const ExportStateSchema = z.object({
  exportId: z.string(),
  state: z.string(),
  downloadUrl: z.string().optional(),
  sizeBytes: z.number().optional(),
  detail: z.string(),
});

export function registerExportTools({ server, api }: ToolRegistration): void {
  server.registerTool(
    'export_app',
    {
      title: 'Request an export',
      description:
        'Ask for a bundle of everything on the app volume. The host allows itself an hour to read one filesystem, so this returns as soon as the request is in — poll `get_export` for the download url.',
      inputSchema: z.object({ app: AppSlugSchema }),
      outputSchema: ExportStateSchema,
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

  server.registerTool(
    'get_export',
    {
      title: 'Check an export',
      description:
        'Whether the bundle is written yet. A download url rather than a state is what says it is: the url is signed and outlives the answer it arrives in by minutes, so read it when it appears rather than reading `state`.',
      inputSchema: z.object({ app: AppSlugSchema, exportId: z.string() }),
      outputSchema: ExportStateSchema,
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
