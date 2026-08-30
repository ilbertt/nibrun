import { deploy } from '@repo/app-operations';
import { z } from 'zod';
import {
  ConfigInputSchema,
  configEdit,
  digest,
  fetchable,
  ReleaseResultSchema,
  released,
} from '#lib/mcp/release.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/mcp/tool.ts';

export function registerDeployAppTool({ server, api }: ToolRegistration): void {
  server.registerTool(
    'deploy_app',
    {
      title: 'Deploy a binary',
      description:
        'Deploy a compiled binary from an https url and run it. nibrun fetches the url itself — there is no way to send a file from this end — and refuses a download that hashes to anything other than `sha256` when one is given. Names an existing app with `app`, or creates one when omitted.',
      inputSchema: z.object({
        url: z
          .string()
          .describe(
            'https url nibrun fetches the binary at. May serve an archive; the executable inside it is unwrapped.',
          ),
        sha256: z
          .string()
          .optional()
          .describe(
            'What the url should hash to, as its release publishes it — for an archive, the archive rather than the executable inside it.',
          ),
        app: AppSlugSchema.optional().describe(
          'Slug of an existing app to deploy onto. A new app is created when omitted.',
        ),
        name: z
          .string()
          .optional()
          .describe('Name for a new app. Defaults to the filename the url ends in.'),
        args: z
          .array(z.string())
          .default([])
          .describe(
            'Arguments the binary is started with, one per element. argv[0] is always the binary itself.',
          ),
        ...ConfigInputSchema,
      }),
      outputSchema: ReleaseResultSchema,
      annotations: { openWorldHint: true },
    },
    ({ url, sha256, app, name, args, wait, ...edit }) =>
      answered({
        produce: async () => {
          const deployed = await deploy({
            api,
            binary: { url: fetchable(url), sha256: digest(sha256) },
            args,
            ...(app !== undefined && { app }),
            ...(name !== undefined && { name }),
            ...configEdit(edit),
          });
          return await released({ api, deployed, wait });
        },
      }),
  );
}
