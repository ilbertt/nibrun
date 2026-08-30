import {
  describeUnservedDeployment,
  parseEnvironmentPatch,
  servingHostname,
} from '@repo/app-operations';
import {
  type DeploymentState,
  HttpPortSchema,
  type Sha256Digest,
  Sha256DigestSchema,
  type TenantEnvironment,
  type TenantEnvironmentPatch,
  Value,
} from '@repo/protocol';
import { z } from 'zod';
import { BadRequestError, GatewayTimeoutError } from '#lib/errors.ts';
import type { McpServices } from '#lib/mcp/services.ts';
import { wait } from '#lib/wait.ts';
import type { PublicApp } from '#services/apps.service.ts';
import type { PublicDeployment } from '#services/deployments.service.ts';

const SECURE_SCHEME = 'https://';

const SETTLING = new Set<DeploymentState>(['pending', 'starting']);
const POLL_INTERVAL_MS = 500;
const SERVING_TIMEOUT_MS = 300_000;

export const ReleaseResultSchema = z.object({
  slug: z.string(),
  url: z.string(),
  deploymentId: z.string(),
  state: z.string(),
  detail: z.string(),
});

/** The half of a release's input that both making one and remaking one take. */
export const ConfigInputSchema = {
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

export type ConfigInput = {
  args?: string[] | undefined;
  port?: number | undefined;
  extraPublicPort?: boolean | undefined;
  environment?: Record<string, string | null> | undefined;
};

/**
 * An edit to what an app already has, where a variable given `null` is one being removed.
 *
 * Every value is parsed into the branded shape the services take. A controller has TypeBox doing
 * this at the edge; a tool is the edge, so it does it here — and a port outside the range costs a
 * sentence rather than reaching a repository as a number nothing checked.
 */
export function configPatch({ args, port, extraPublicPort, environment }: ConfigInput) {
  return {
    ...(args !== undefined && { args }),
    ...(port !== undefined && { httpPort: Value.Parse(HttpPortSchema, port) }),
    ...(extraPublicPort !== undefined && { hasExtraPublicPort: extraPublicPort }),
    ...(environment !== undefined && { environment: patched(environment) }),
  };
}

/**
 * The same edit for an app being created, which has nothing to leave alone and nothing to remove —
 * so a variable given `null` is dropped rather than carried as an instruction nothing could follow.
 */
export function newAppConfig(input: ConfigInput) {
  const { environment, ...rest } = configPatch(input);
  return {
    ...rest,
    ...(environment !== undefined && { environment: withoutRemovals(environment) }),
  };
}

function patched(environment: Record<string, string | null>): TenantEnvironmentPatch {
  return parseEnvironmentPatch(
    Object.entries(environment).map(([name, value]) => ({ name, value })),
  );
}

function withoutRemovals(patch: TenantEnvironmentPatch): TenantEnvironment {
  return Object.fromEntries(
    Object.entries(patch).flatMap(([name, value]) => (value === null ? [] : [[name, value]])),
  ) as TenantEnvironment;
}

/**
 * Refused here rather than fetched, because the other reading of an http url is one nibrun would
 * pull a binary over cleartext.
 */
export function fetchable(url: string): string {
  if (!url.startsWith(SECURE_SCHEME)) {
    throw new BadRequestError(`A binary is fetched over https, and this is not: ${url}`);
  }
  return url;
}

/** The digest in the one spelling the api reads it in, so a mistyped one costs a line rather than a fetch. */
export function digest(sha256: string | undefined): Sha256Digest | undefined {
  if (sha256 === undefined) {
    return undefined;
  }
  try {
    return Value.Parse(Sha256DigestSchema, sha256.trim().toLowerCase());
  } catch {
    throw new BadRequestError(
      `A checksum is the 64 hex characters sha256sum prints, and this is not: ${sha256}`,
    );
  }
}

/**
 * What the release did, once it has stopped moving. A release that settled anywhere but running is
 * raised rather than returned, so the host account of why reaches the caller as the answer instead
 * of as a field it has to think to read.
 */
export async function released({
  services,
  ownerId,
  app,
  deployment,
  wait,
}: {
  services: McpServices;
  ownerId: PublicApp['ownerId'];
  app: PublicApp;
  deployment: PublicDeployment;
  wait: boolean;
}) {
  const url = `https://${servingHostname(app.hostnames)}`;
  const staged = { slug: app.slug, url, deploymentId: deployment.id };
  if (!wait) {
    return { ...staged, state: deployment.state, detail: `${url} — the release is starting.` };
  }

  const settled = await settledRelease({ services, ownerId, app, deployment });
  if (settled.state !== 'running') {
    throw new BadRequestError(describeUnservedDeployment(settled));
  }
  return { ...staged, state: settled.state, detail: `${url} is serving.` };
}

async function settledRelease({
  services,
  ownerId,
  app,
  deployment,
}: {
  services: McpServices;
  ownerId: PublicApp['ownerId'];
  app: PublicApp;
  deployment: PublicDeployment;
}): Promise<PublicDeployment> {
  // The ceiling doubles as what ends the pause between polls, so a release that never settles
  // stops costing a wait the moment it has run out of time rather than one interval later.
  const signal = AbortSignal.timeout(SERVING_TIMEOUT_MS);
  while (!signal.aborted) {
    const found = await services.deployments.get({
      appId: app.id,
      deploymentId: deployment.id,
      ownerId,
    });
    if (!SETTLING.has(found.state)) {
      return found;
    }
    await wait({ ms: POLL_INTERVAL_MS, signal });
  }
  throw new GatewayTimeoutError(
    `Deployment ${deployment.id} was still starting after ${SERVING_TIMEOUT_MS}ms.`,
  );
}
