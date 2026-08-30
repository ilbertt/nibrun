import { addressedDeployment, guestPath, readDirectory } from '@repo/app-operations';
import { z } from 'zod';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/mcp/tool.ts';

const ROOT = '/';

export function registerListFilesTool({ server, api }: ToolRegistration): void {
  server.registerTool(
    'list_files',
    {
      title: 'List files on an app volume',
      description:
        'Read one directory of the persistent volume the app has mounted at `data/`. Read inside the running microVM, so an app that is not running has nothing mounting its filesystem — take an export instead.',
      inputSchema: z.object({
        app: AppSlugSchema,
        path: z
          .string()
          .default(ROOT)
          .describe('Absolute path within the volume. No `.`, no `..`, no trailing slash.'),
      }),
      outputSchema: z.object({
        path: z.string(),
        truncated: z.boolean(),
        entries: z.array(
          z.object({
            name: z.string(),
            kind: z.string(),
            sizeBytes: z.number(),
            modifiedAt: z.string(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ app: slug, path }) =>
      answered({
        produce: async () => {
          const { appId, deploymentId } = await addressedDeployment({
            api,
            slug,
            deploymentId: undefined,
            operation: 'files',
          });
          return await readDirectory({ api, appId, deploymentId, path: guestPath(path) });
        },
      }),
  );
}
