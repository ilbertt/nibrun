import type { TenantArguments, TenantEnvironmentPatch } from '@repo/api-client/models';

/** Where a release landed and what to reach it at, whichever way it was asked for. */
export type Deployed = {
  appId: string;
  name: string;
  deploymentId: string;
  url: string;
};

export type DeployStep =
  | { kind: 'app'; appId: string; name: string }
  | { kind: 'artifact'; artifactId: string; digest: string; reused: boolean }
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
    ...(port !== undefined && { httpPort: port }),
    ...(extraPublicPort !== undefined && { hasExtraPublicPort: extraPublicPort }),
    ...(environment !== undefined && { environment }),
  };
}

/** Everything an owner may change about an app in one patch: the config, and what it is called. */
export type AppEdit = ConfigEdit & {
  /** What to call the app from now on. Its hostnames stay: the slug never follows a rename. */
  name?: string | undefined;
};

export function appPatch({ name, ...edit }: AppEdit) {
  return {
    ...configPatch(edit),
    ...(name !== undefined && { name }),
  };
}
