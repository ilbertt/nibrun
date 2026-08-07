import { z } from 'zod';

export const PROGRAM_NAME = 'nib';

export const DEFAULT_API_URL = 'https://app.nibrun.com';

/**
 * Flags asked for by more than one command, spelled once so two commands cannot end up asking for
 * the same thing by different names.
 */
export enum SharedOption {
  App = 'app',
  DeploymentId = 'deployment-id',
}

/**
 * Only the name of `--app` is shared, because what an app is to each command is not: `nib run`
 * deploys onto one, `nib apps` works with one. A deployment is the same deployment wherever it is
 * named, so this one is shared whole and a site adds nothing but whether it forwards.
 */
export const DEPLOYMENT_ID_OPTION = {
  schema: z.string().min(1).optional(),
  description: 'Read this deployment instead of looking up the app latest.',
};
