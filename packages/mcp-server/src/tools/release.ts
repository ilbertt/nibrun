import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError } from '@repo/api-client/unwrap';
import {
  awaitDeploymentSettled,
  type ConfigEdit,
  type Deployed,
  deploy,
  describeUnservedDeployment,
  parseEnvironmentPatch,
  redeploy,
} from '@repo/app-operations';
import { type Sha256Digest, Sha256DigestSchema, Value } from '@repo/protocol';
import { z } from 'zod';
import { AppSlugSchema, answered, type ToolRegistration } from '#tool.ts';

const SECURE_SCHEME = 'https://';

const ReleaseResultSchema = z.object({
  slug: z.string(),
  url: z.string(),
  deploymentId: z.string(),
  state: z.string(),
  detail: z.string(),
});

const ConfigInputSchema = {
  port: z
    .number()
    .int()
    .optional()
    .describe('The port the binary listens on for HTTP. Left as the app has it when omitted.'),
  extraPublicPort: z
    .boolean()
    .optional()
    .describe(
      'Whether the app is reached on a public TCP and UDP port besides HTTP. Which port is nibrun to decide; the guest is told which it got.',
    ),
  environment: z
    .record(z.string(), z.string().nullable())
    .optional()
    .describe(
      'An edit, not the whole environment: a variable named here is set, one given null is removed, and one not named is left alone. Values are never readable back.',
    ),
  wait: z
    .boolean()
    .default(true)
    .describe(
      'Wait for the release to come up and report what it did. False returns as soon as the deployment is staged.',
    ),
};

export function registerReleaseTools({ server, api }: ToolRegistration): void {
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

type ConfigInput = {
  args?: string[] | undefined;
  port?: number | undefined;
  extraPublicPort?: boolean | undefined;
  environment?: Record<string, string | null> | undefined;
};

function configEdit({ args, port, extraPublicPort, environment }: ConfigInput): ConfigEdit {
  return {
    ...(args !== undefined && { args }),
    ...(port !== undefined && { port }),
    ...(extraPublicPort !== undefined && { extraPublicPort }),
    ...(environment !== undefined && {
      environment: parseEnvironmentPatch(
        Object.entries(environment).map(([name, value]) => ({ name, value })),
      ),
    }),
  };
}

/**
 * Refused here rather than sent, because the other reading of an http url is one nibrun would
 * fetch a binary over cleartext — and the api is the end that fetches, so nothing on this end
 * would notice.
 */
function fetchable(url: string): string {
  if (!url.startsWith(SECURE_SCHEME)) {
    throw new ApiError(`A binary is fetched over https, and this is not: ${url}`);
  }
  return url;
}

/** The digest in the one spelling the api reads it in, so a mistyped one costs a line rather than the whole transfer it would fail at the end of. */
function digest(sha256: string | undefined): Sha256Digest | undefined {
  if (sha256 === undefined) {
    return undefined;
  }
  try {
    return Value.Parse(Sha256DigestSchema, sha256.trim().toLowerCase());
  } catch {
    throw new ApiError(
      `A checksum is the 64 hex characters sha256sum prints, and this is not: ${sha256}`,
    );
  }
}

/**
 * What the release did, once it has stopped moving. A release that settled anywhere but running
 * is raised rather than returned, so the host account of why reaches the caller as the answer
 * instead of as a field it has to think to read.
 */
async function released({
  api,
  deployed,
  wait,
}: {
  api: PublicApiClient;
  deployed: Deployed;
  wait: boolean;
}) {
  const staged = {
    slug: deployed.slug,
    url: deployed.url,
    deploymentId: deployed.deploymentId,
  };
  if (!wait) {
    return { ...staged, state: 'pending', detail: `${deployed.url} — the release is starting.` };
  }

  const settled = await awaitDeploymentSettled({
    api,
    appId: deployed.appId,
    deploymentId: deployed.deploymentId,
  });
  if (settled.state !== 'running') {
    throw new ApiError(describeUnservedDeployment(settled));
  }
  return { ...staged, state: settled.state, detail: `${deployed.url} is serving.` };
}
