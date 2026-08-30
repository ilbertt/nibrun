import { redeploy } from '@repo/app-operations';
import { z } from 'zod';
import { ConfigInputSchema, configEdit, ReleaseResultSchema, released } from '#lib/release.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/tool.ts';

export function registerRedeployAppTool({ server, api }: ToolRegistration): void {
  server.registerTool(
    'redeploy_app',
    {
      title: 'Redeploy an app',
      description:
        'Release the binary the app is already running, with whatever this changes about how it starts. The bytes are already stored, so nothing is fetched — this is how an argument or a variable is changed.',
      inputSchema: z.object({
        app: AppSlugSchema,
        args: z
          .array(z.string())
          .optional()
          .describe(
            'The whole argument list, not an edit to it. Left as the app has it when omitted.',
          ),
        ...ConfigInputSchema,
      }),
      outputSchema: ReleaseResultSchema,
      annotations: { openWorldHint: true },
    },
    ({ app, wait, ...edit }) =>
      answered({
        produce: async () => {
          const deployed = await redeploy({ api, app, ...configEdit(edit) });
          return await released({ api, deployed, wait });
        },
      }),
  );
}
