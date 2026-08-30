import { z } from 'zod';
import { releaseOf } from '#lib/mcp/apps.ts';
import { ConfigInputSchema, configPatch, ReleaseResultSchema, released } from '#lib/mcp/release.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/mcp/tool.ts';

export function registerRedeployAppTool({ server, services, ownerId }: ToolRegistration): void {
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
    ({ app: slug, wait, ...edit }) =>
      answered({
        produce: async () => {
          // Which artifact is read before the config is written: an app that has never been
          // deployed has no binary to run again, and finding that out afterwards would leave it
          // configured for a release nobody made.
          const { app, newest } = await releaseOf({
            services,
            ownerId,
            slug,
            operation: 'release',
          });
          const configured = await services.apps.updateConfig({
            appId: app.id,
            ownerId,
            patch: configPatch(edit),
          });
          const deployment = await services.deployments.createOrRollback({
            appId: app.id,
            ownerId,
            source: { artifactId: newest.artifactId },
          });
          return await released({ services, ownerId, app: configured, deployment, wait });
        },
      }),
  );
}
