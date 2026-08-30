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
  // A yes or no rather than a number: which port an app is given is nibrun's to decide, because it
  // has to be the same on every hop for a binary announcing the one it bound to be reachable.
  extraPublicPort?: boolean | undefined;
  environment?: TenantEnvironmentPatch | undefined;
};

export function configPatch({ args, port, extraPublicPort, environment }: ConfigEdit) {
  return {
    ...(args !== undefined && { args }),
    ...(port !== undefined && { httpPort: Value.Parse(HttpPortSchema, port) }),
    ...(extraPublicPort !== undefined && { hasExtraPublicPort: extraPublicPort }),
    ...(environment !== undefined && { environment }),
  };
}
