import {
  appQuotaRefusal,
  type Deployed,
  type DeployStep,
  type UploadProgress,
} from '@repo/app-operations';
import type { AppQuotaRefusal } from '@repo/protocol';
import { useState } from 'react';
import {
  type BinaryDelivery,
  binaryDelivery,
  carriesInitialData,
  type ReleaseRequest,
  useDeploy,
} from '#lib/hooks/use-deploy.ts';

export type DeployPhase =
  | 'idle'
  | 'uploading'
  | 'uploading-data'
  | 'fetching'
  | 'releasing'
  | 'settling'
  | 'done'
  | 'failed';

/** The phases where the release is in flight and nothing is left for this end to send. */
export function isReleasing(phase: DeployPhase): boolean {
  return phase === 'releasing' || phase === 'settling';
}

/** The phases whose bytes are leaving this end, which are the ones there is a meter for. */
export function isUploading(phase: DeployPhase): boolean {
  return phase === 'uploading' || phase === 'uploading-data';
}

/**
 * What the run was asked to send, because the steps cannot say it: a release that reuses the stored
 * binary reports the same artifact as one that just uploaded it, one the api fetched reports it
 * without this end having sent a byte, and an archive is reported as nothing at all.
 */
type Sending = {
  binary: BinaryDelivery;
  initialData: boolean;
};

const SENDING_NOTHING: Sending = { binary: 'none', initialData: false };

export type DeployRun = {
  phase: DeployPhase;
  steps: readonly DeployStep[];
  progress: UploadProgress | undefined;
  deployed: Deployed | undefined;
  reason: string | undefined;
  /** The same failure as `reason`, where it was the account's limit and there is a number to ask against. */
  overQuota: AppQuotaRefusal | undefined;
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
  const [sending, setSending] = useState<Sending>(SENDING_NOTHING);
  const run = useDeploy({
    onStep: (step) => setSteps((seen) => [...seen, step]),
    onProgress: setProgress,
    onDeployed,
  });

  return {
    phase: phaseOf({ status: run.status, steps, sending }),
    steps,
    progress,
    deployed: run.data,
    reason: run.error?.message,
    overQuota: appQuotaRefusal(run.error),
    start: (request) => {
      setSteps([]);
      setProgress(undefined);
      setSending({ binary: binaryDelivery(request), initialData: carriesInitialData(request) });
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
  sending,
}: {
  status: 'idle' | 'pending' | 'success' | 'error';
  steps: readonly DeployStep[];
  sending: Sending;
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
  // The archive is sent after the binary, so the artifact is the only thing that says which of the
  // two the meter is on.
  if (sending.initialData && steps.some((step) => step.kind === 'artifact')) {
    return 'uploading-data';
  }
  if (sending.binary === 'none') {
    return 'releasing';
  }
  return sending.binary === 'upload' ? 'uploading' : 'fetching';
}
