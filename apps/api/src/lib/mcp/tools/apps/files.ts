import { guestPath } from '@repo/app-operations';
import { z } from 'zod';
import { releaseOf } from '#lib/mcp/apps.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/mcp/tool.ts';

const ROOT = '/';

/** A directory read waits on a host answering, and nothing else here ends that wait. */
const READ_TIMEOUT_MS = 30_000;

export function registerListFilesTool({ server, services, ownerId }: ToolRegistration): void {
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
          const { app, newest } = await releaseOf({ services, ownerId, slug, operation: 'files' });
          return await services.filesystem.readDirectory({
            appId: app.id,
            deploymentId: newest.id,
            ownerId,
            path: guestPath(path),
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
          });
        },
      }),
  );
}
