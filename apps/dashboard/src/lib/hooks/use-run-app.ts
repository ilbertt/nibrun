import type { Deployed, DeployStep, UploadProgress } from '@repo/app-operations';
import { useState } from 'react';
import { carriesBinary, type ReleaseRequest, useDeploy } from '#lib/hooks/use-deploy.ts';

export type DeployPhase = 'idle' | 'uploading' | 'releasing' | 'settling' | 'done' | 'failed';

export type DeployRun = {
  phase: DeployPhase;
  steps: readonly DeployStep[];
  progress: UploadProgress | undefined;
  deployed: Deployed | undefined;
  reason: string | undefined;
  start: (request: ReleaseRequest) => void;
  reset: () => void;
};

export function useRunApp({
  onDeployed,
}: {
  onDeployed: ((deployed: Deployed) => void) | undefined;
}): DeployRun {
  const [steps, setSteps] = useState<readonly DeployStep[]>([]);
  const [progress, setProgress] = useState<UploadProgress | undefined>(undefined);
  // What the run was asked for, because the steps cannot say it: a release that reuses the stored
  // binary reports the same artifact as one that just uploaded it.
  const [uploading, setUploading] = useState(false);
  const run = useDeploy({
    onStep: (step) => setSteps((seen) => [...seen, step]),
    onProgress: setProgress,
    onDeployed,
  });

  return {
    phase: phaseOf({ status: run.status, steps, uploading }),
    steps,
    progress,
    deployed: run.data,
    reason: run.error?.message,
    start: (request) => {
      setSteps([]);
      setProgress(undefined);
      setUploading(carriesBinary(request));
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
  uploading,
}: {
  status: 'idle' | 'pending' | 'success' | 'error';
  steps: readonly DeployStep[];
  uploading: boolean;
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
  if (steps.some((step) => step.kind === 'deployment')) {
    return 'settling';
  }
  return uploading ? 'uploading' : 'releasing';
}
