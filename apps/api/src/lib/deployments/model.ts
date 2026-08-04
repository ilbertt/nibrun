import type { DeploymentId, DeploymentState, InstanceState } from '@repo/protocol';
import * as Data from 'effect/Data';
import type { DeploymentPersistenceError } from '#lib/deployments/store.ts';
import type { DeploymentStateSnapshot } from '#repositories/deployment.repository.ts';

export type DeploymentEvent = Data.TaggedEnum<{
  Scheduled: {
    targetGeneration: number;
    deadlineAt: Date;
  };
  InstanceReported: {
    observedGeneration: number;
    instanceState: InstanceState;
    reportedAt: Date;
    message: string | null;
  };
  DeadlineReached: {
    at: Date;
  };
  CancellationRequested: Record<never, never>;
  ReplacementActivated: {
    at: Date;
  };
}>;

export const DeploymentEvent = Data.taggedEnum<DeploymentEvent>();

export type DeploymentTransitionResult = Data.TaggedEnum<{
  Unchanged: {
    deployment: DeploymentStateSnapshot;
  };
  Transitioned: {
    previous: DeploymentStateSnapshot;
    current: DeploymentStateSnapshot;
  };
}>;

export const DeploymentTransitionResult = Data.taggedEnum<DeploymentTransitionResult>();

export class DeploymentNotFound extends Data.TaggedError('DeploymentNotFound')<{
  deploymentId: DeploymentId;
}> {}

export class ConcurrentDeploymentTransition extends Data.TaggedError(
  'ConcurrentDeploymentTransition',
)<{
  deploymentId: DeploymentId;
}> {}

export class InvalidDeploymentTransition extends Data.TaggedError('InvalidDeploymentTransition')<{
  deploymentId: DeploymentId;
  state: DeploymentState;
  event: DeploymentEvent['_tag'];
}> {}

export type DeploymentStateMachineError =
  | DeploymentPersistenceError
  | DeploymentNotFound
  | ConcurrentDeploymentTransition
  | InvalidDeploymentTransition;
