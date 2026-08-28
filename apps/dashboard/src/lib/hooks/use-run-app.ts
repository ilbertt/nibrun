import type { Deployed, DeployStep, UploadProgress } from '@repo/app-operations';
import { useState } from 'react';
import {
  type BinaryDelivery,
  binaryDelivery,
  type ReleaseRequest,
  useDeploy,
} from '#lib/hooks/use-deploy.ts';

export type DeployPhase =
  | 'idle'
  | 'uploading'
  | 'fetching'
  | 'releasing'
  | 'settling'
  | 'done'
  | 'failed';

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
  // binary reports the same artifact as one that just uploaded it, and one the api fetched reports
  // it without this end having sent a byte.
  const [delivery, setDelivery] = useState<BinaryDelivery>('none');
  const run = useDeploy({
    onStep: (step) => setSteps((seen) => [...seen, step]),
    onProgress: setProgress,
    onDeployed,
  });

  return {
    phase: phaseOf({ status: run.status, steps, delivery }),
    steps,
    progress,
    deployed: run.data,
    reason: run.error?.message,
    start: (request) => {
      setSteps([]);
      setProgress(undefined);
      setDelivery(binaryDelivery(request));
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
  delivery,
}: {
  status: 'idle' | 'pending' | 'success' | 'error';
  steps: readonly DeployStep[];
  delivery: BinaryDelivery;
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
  if (delivery === 'none') {
    return 'releasing';
  }
  return delivery === 'upload' ? 'uploading' : 'fetching';
}
