import { deploy } from '@repo/app-operations';
import type { DeployLink } from '@repo/deploy-link';
import { z } from 'zod';
import { AskedForBinarySchema, askForBinary } from '#lib/ask-for-binary.ts';
import {
  ConfigInputSchema,
  configEdit,
  digest,
  fetchable,
  ReleaseResultSchema,
  released,
} from '#lib/release.ts';
import { AppSlugSchema, answered, type ToolRegistration } from '#lib/tool.ts';

export function registerDeployAppTool({ server, api, origin, era }: ToolRegistration): void {
  server.registerTool(
    'deploy_app',
    {
      title: 'Deploy a binary',
      description:
        'Deploy a compiled binary from an https url and run it. nibrun fetches the url itself and refuses a download that hashes to anything other than `sha256` when one is given. Names an existing app with `app`, or creates one when omitted. Called without `url` — for a binary on the caller machine, which nothing here can reach — it answers with the deploy screen, filled in with everything else given, for the caller to pick the file themselves.',
      inputSchema: z.object({
        url: z
          .string()
          .optional()
          .describe(
            'https url nibrun fetches the binary at. May serve an archive; the executable inside it is unwrapped. Omit for a binary the caller has to hand over themselves.',
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
      // Either outcome, because the tool genuinely has two: the release it made, or the page to
      // go and make one on. A caller reads which by whether `deployUrl` is there.
      outputSchema: z.union([ReleaseResultSchema, AskedForBinarySchema]),
      annotations: { openWorldHint: true },
    },
    // biome-ignore lint/complexity/useMaxParams: the sdk hands a tool handler its request context
    ({ url, sha256, app, name, args, wait, ...edit }, context) => {
      if (url === undefined) {
        return askForBinary({
          origin,
          era,
          responses: context.mcpReq?.inputResponses,
          link: asDeployLink({ sha256, name, args, ...edit }),
        });
      }
      return answered({
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
      });
    },
  );
}

/**
 * What the deploy screen can be handed of a call that named no binary.
 *
 * Not everything survives the trip: the screen creates an app rather than releasing onto one, so
 * `app` has nowhere to go, and a variable being removed means nothing on a form that has never
 * set one. Both only arise on a deploy that named a url, which is not this one.
 */
function asDeployLink({
  sha256,
  name,
  args,
  port,
  extraPublicPort,
  environment,
}: {
  sha256?: string | undefined;
  name?: string | undefined;
  args?: string[] | undefined;
  port?: number | undefined;
  extraPublicPort?: boolean | undefined;
  environment?: Record<string, string | null> | undefined;
}): DeployLink {
  const assigned = Object.entries(environment ?? {}).flatMap(([variable, value]) =>
    value === null ? [] : [`${variable}=${value}`],
  );
  return {
    ...(name !== undefined && { name }),
    ...(sha256 !== undefined && { sha256 }),
    ...(port !== undefined && { port }),
    ...(extraPublicPort !== undefined && { 'extra-public-port': extraPublicPort }),
    ...(args !== undefined && args.length > 0 && { arg: args }),
    ...(assigned.length > 0 && { env: assigned }),
  };
}
