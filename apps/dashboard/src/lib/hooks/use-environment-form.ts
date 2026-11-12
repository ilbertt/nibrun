import { parseEnvironmentPatch } from '@repo/app-operations';
import { useState } from 'react';
import {
  type EnvironmentVariable,
  environmentEdits,
  storedNames,
  storedVariables,
} from '#lib/environment-variables.ts';
import { useAppStatus } from '#lib/hooks/use-app-status.ts';
import { validateEnvironment } from '#lib/hooks/use-deploy-form.ts';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import { useUpdateApp } from '#lib/hooks/use-update-app.ts';
import type { AppSummary } from '#queries/apps.ts';

export type EnvironmentForm = {
  variables: EnvironmentVariable[];
  change: (variables: EnvironmentVariable[]) => void;
  error: string | undefined;
  submittable: boolean;
  saveOnly: boolean;
  saving: boolean;
  reset: () => void;
  submit: () => void;
};

export function useEnvironmentForm({
  app,
  onSaved,
}: {
  app: AppSummary;
  onSaved: () => void;
}): EnvironmentForm {
  const { start } = useDeployRun();
  const update = useUpdateApp(app.id);
  const saveOnly = useAppStatus(app).status?.kind === 'never-deployed';
  // Untouched is `undefined` rather than the rows the app has, so the seed follows the app while
  // the dialog sits open and a release settling behind it does not overwrite what is being typed.
  const [edited, setEdited] = useState<EnvironmentVariable[] | undefined>(undefined);

  const edits = environmentEdits({ variables: edited, stored: storedNames(app) });
  const error = validateEnvironment({ value: edited });

  return {
    variables: edited ?? storedVariables(app),
    change: function changeVariables(variables) {
      update.reset();
      setEdited(variables);
    },
    error: error ?? update.error?.message,
    submittable: edits.length > 0 && error === undefined && !update.isPending,
    saveOnly,
    saving: update.isPending,
    reset: function reset() {
      update.reset();
      setEdited(undefined);
    },
    submit: function submit() {
      const environment = parseEnvironmentPatch(edits);
      if (saveOnly) {
        update.mutate({ environment }, { onSuccess: onSaved });
        return;
      }
      start({
        appId: app.id,
        args: app.config.args,
        port: app.config.httpPort,
        environment,
      });
    },
  };
}
