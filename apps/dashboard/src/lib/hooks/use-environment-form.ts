import { parseEnvironmentPatch } from '@repo/app-operations';
import { useState } from 'react';
import {
  type EnvironmentVariable,
  environmentEdits,
  storedNames,
  storedVariables,
} from '#lib/environment-variables.ts';
import { validateEnvironment } from '#lib/hooks/use-deploy-form.ts';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import type { AppSummary } from '#queries/apps.ts';

export type EnvironmentForm = {
  variables: EnvironmentVariable[];
  change: (variables: EnvironmentVariable[]) => void;
  error: string | undefined;
  submittable: boolean;
  reset: () => void;
  submit: () => void;
};

/**
 * An app's environment on its own, as the release that changes it. A variable is only what the
 * binary runs with once something runs with it, so saving is a deploy — of the artifact the app
 * already has, with everything else about how it starts left exactly as it is.
 */
export function useEnvironmentForm(app: AppSummary): EnvironmentForm {
  const { start } = useDeployRun();
  // Untouched is `undefined` rather than the rows the app has, so the seed follows the app while
  // the dialog sits open and a release settling behind it does not overwrite what is being typed.
  const [edited, setEdited] = useState<EnvironmentVariable[] | undefined>(undefined);

  const edits = environmentEdits({ variables: edited, stored: storedNames(app) });
  const error = validateEnvironment({ value: edited });

  return {
    variables: edited ?? storedVariables(app),
    change: setEdited,
    error,
    submittable: edits.length > 0 && error === undefined,
    reset: () => setEdited(undefined),
    submit: () =>
      start({
        app: app.slug,
        args: app.config.args,
        port: app.config.guestPort,
        environment: parseEnvironmentPatch(edits),
      }),
  };
}
