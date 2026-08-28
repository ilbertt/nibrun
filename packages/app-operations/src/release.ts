import { ApiError } from '@repo/api-client/unwrap';
import {
  HttpPortSchema,
  type TenantArguments,
  type TenantEnvironmentPatch,
  Value,
} from '@repo/protocol';

/** Where a release landed and what to reach it at, whichever way it was asked for. */
export type Deployed = {
  appId: string;
  slug: string;
  deploymentId: string;
  url: string;
};

export type DeployStep =
  | { kind: 'app'; appId: string; slug: string }
  | { kind: 'artifact'; artifactId: string; digest: string }
  | { kind: 'deployment'; deploymentId: string };

/**
 * What a release is asked to change about the way the binary is started. Everything absent is
 * left as the app has it, which is what lets one variable be changed without restating the rest.
 *
 * `environment` is an edit where `args` is the whole list — a caller cannot read a secret back to
 * restate it, so saying nothing about a variable has to be how it survives, while saying nothing
 * about arguments can only mean the ones already there.
 */
export type ConfigEdit = {
  args?: TenantArguments | undefined;
  port?: number | undefined;
  environment?: TenantEnvironmentPatch | undefined;
};

export function configPatch({ args, port, environment }: ConfigEdit) {
  return {
    ...(args !== undefined && { args }),
    ...(port !== undefined && { httpPort: Value.Parse(HttpPortSchema, port) }),
    ...(environment !== undefined && { environment }),
  };
}

/**
 * The address to hand back, preferring a domain the owner brought: the platform hostname is what
 * nibrun issued, but a custom one is what they call their app.
 *
 * Active only. A brought domain is pending until the edge holds a certificate for it, and a link
 * that does not resolve yet is worse than the one that does.
 */
export function servingHostname(
  hostnames: ReadonlyArray<{ hostname: string; kind: string; state: string }>,
): string {
  const serving =
    hostnames.find((entry) => entry.kind === 'custom' && entry.state === 'active') ??
    hostnames.find((entry) => entry.kind === 'platform') ??
    hostnames[0];
  if (!serving) {
    throw new ApiError('The app was created without a hostname.');
  }
  return serving.hostname;
}
