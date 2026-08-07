import type { Deployed, DeployStep } from '@repo/app-operations';
import { useState } from 'react';
import { type DeployRequest, useDeploy } from '#lib/hooks/use-deploy.ts';

export type DeployPhase = 'idle' | 'uploading' | 'settling' | 'done' | 'failed';

export type DeployRun = {
  phase: DeployPhase;
  steps: readonly DeployStep[];
  deployed: Deployed | undefined;
  reason: string | undefined;
  start: (request: DeployRequest) => void;
  reset: () => void;
};

export function useRunApp(): DeployRun {
  const [steps, setSteps] = useState<readonly DeployStep[]>([]);
  const run = useDeploy({
    onStep: (step) => setSteps((seen) => [...seen, step]),
  });

  return {
    phase: phaseOf({ status: run.status, steps }),
    steps,
    deployed: run.data,
    reason: run.error?.message,
    start: (request) => {
      setSteps([]);
      run.mutate(request);
    },
    reset: () => {
      setSteps([]);
      run.reset();
    },
  };
}

function phaseOf({
  status,
  steps,
}: {
  status: 'idle' | 'pending' | 'success' | 'error';
  steps: readonly DeployStep[];
}): DeployPhase {
  if (status === 'success') {
    return 'done';
  }
  if (status === 'error') {
    return 'failed';
  }
  if (status === 'idle') {
    return 'idle';
  }
  return steps.some((step) => step.kind === 'deployment') ? 'settling' : 'uploading';
}
