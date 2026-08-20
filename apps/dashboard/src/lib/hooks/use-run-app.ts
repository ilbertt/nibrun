import type { Deployed, DeployStep, UploadProgress } from '@repo/app-operations';
import { useState } from 'react';
import { type DeployRequest, useDeploy } from '#lib/hooks/use-deploy.ts';

export type DeployPhase = 'idle' | 'uploading' | 'settling' | 'done' | 'failed';

export type DeployRun = {
  phase: DeployPhase;
  steps: readonly DeployStep[];
  progress: UploadProgress | undefined;
  deployed: Deployed | undefined;
  reason: string | undefined;
  start: (request: DeployRequest) => void;
  reset: () => void;
};

export function useRunApp({ onDeployed }: { onDeployed: (() => void) | undefined }): DeployRun {
  const [steps, setSteps] = useState<readonly DeployStep[]>([]);
  const [progress, setProgress] = useState<UploadProgress | undefined>(undefined);
  const run = useDeploy({
    onStep: (step) => setSteps((seen) => [...seen, step]),
    onProgress: setProgress,
    onDeployed,
  });

  return {
    phase: phaseOf({ status: run.status, steps }),
    steps,
    progress,
    deployed: run.data,
    reason: run.error?.message,
    start: (request) => {
      setSteps([]);
      setProgress(undefined);
      run.mutate(request);
    },
    reset: () => {
      setSteps([]);
      setProgress(undefined);
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
