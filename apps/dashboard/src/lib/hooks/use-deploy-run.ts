import { useContext } from 'react';
import { DeployRunContext } from '#lib/contexts/deploy-run-context.ts';
import type { DeployRun } from '#lib/hooks/use-run-app.ts';

export function useDeployRun(): DeployRun {
  const run = useContext(DeployRunContext);
  if (run === undefined) {
    throw new Error('A deploy run is only readable inside a DeployRunProvider.');
  }
  return run;
}
