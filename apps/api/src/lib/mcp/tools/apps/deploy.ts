import { z } from 'zod';
import { appFor } from '#lib/mcp/apps.ts';
import {
  ConfigInputSchema,
  configPatch,
  digest,
  fetchable,
  newAppConfig,
  ReleaseResultSchema,
  released,
} from '#lib/mcp/release.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/mcp/tool.ts';
import type { PublicApp } from '#services/apps.service.ts';

export function registerDeployAppTool({ server, services, ownerId }: ToolRegistration): void {
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
    ({ url, sha256, app: slug, name, args, wait, ...edit }) =>
      answered({
        produce: async () => {
          // Config is written before the deployment rather than sent with it: a deployment
          // snapshots the app's config as it stands, so this is the only order in which the flags
          // a caller just gave are the ones that run.
          const app = await configured({
            services,
            ownerId,
            slug,
            name,
            url,
            edit: { ...edit, args },
          });
          const artifact = await services.artifacts.createFromUrl({
            appId: app.id,
            ownerId,
            url: fetchable(url),
            sha256: digest(sha256),
          });
          const deployment = await services.deployments.createOrRollback({
            appId: app.id,
            ownerId,
            source: { artifactId: artifact.id },
          });
          return await released({ services, ownerId, app, deployment, wait });
        },
      }),
  );
}

/**
 * The app the release lands on, configured as this call asks.
 *
 * Named before anything is fetched rather than by the request that fetches: an app created for a
 * deploy that cannot go on is one the caller is left to go and delete.
 */
async function configured({
  services,
  ownerId,
  slug,
  name,
  url,
  edit,
}: {
  services: ToolRegistration['services'];
  ownerId: ToolRegistration['ownerId'];
  slug: string | undefined;
  name: string | undefined;
  url: string;
  edit: Parameters<typeof configPatch>[0];
}): Promise<PublicApp> {
  if (slug === undefined) {
    return await services.apps.create({
      ownerId,
      name: name ?? lastSegment(url),
      config: newAppConfig(edit),
    });
  }
  const { app } = await appFor({ services, ownerId, slug, operation: 'release' });
  return await services.apps.updateConfig({ appId: app.id, ownerId, patch: configPatch(edit) });
}

/**
 * What to call the app when the caller named none: the binary, as the url's path spells it.
 *
 * Parsed rather than split, because the api names the stored artifact the same way — a name taken
 * any other way is one it would refuse after this end had already made the app.
 */
function lastSegment(url: string): string {
  try {
    const segment = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
    return segment === '' ? url : segment;
  } catch {
    return url;
  }
}
