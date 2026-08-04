import type { DeploymentState } from '@repo/protocol';
import * as Effect from 'effect/Effect';
import * as Match from 'effect/Match';
import * as Option from 'effect/Option';
import { type DeploymentEvent, InvalidDeploymentTransition } from '#lib/deployments/model.ts';
import type {
  DeploymentStateSnapshot,
  DeploymentTransition,
} from '#repositories/deployment.repository.ts';

function unchanged(): Option.Option<DeploymentTransition> {
  return Option.none();
}

function nextSnapshot({
  deployment,
  state,
  targetGeneration = deployment.targetGeneration,
  deadlineAt = deployment.deadlineAt,
  activatedAt = deployment.activatedAt,
  failureReason = null,
}: {
  deployment: DeploymentStateSnapshot;
  state: DeploymentState;
  targetGeneration?: number | null;
  deadlineAt?: Date | null;
  activatedAt?: Date | null;
  failureReason?: string | null;
}): DeploymentTransition {
  return {
    deploymentId: deployment.id,
    expectedState: deployment.state,
    next: {
      state,
      targetGeneration,
      deadlineAt,
      activatedAt,
      failureReason,
    },
  };
}

function scheduledTransition({
  deployment,
  event,
}: {
  deployment: DeploymentStateSnapshot;
  event: Extract<DeploymentEvent, { _tag: 'Scheduled' }>;
}): Effect.Effect<Option.Option<DeploymentTransition>, InvalidDeploymentTransition> {
  if (deployment.state === 'pending') {
    return Effect.succeed(
      Option.some(
        nextSnapshot({
          deployment,
          state: 'starting',
          targetGeneration: event.targetGeneration,
          deadlineAt: event.deadlineAt,
        }),
      ),
    );
  }
  if (
    deployment.targetGeneration === event.targetGeneration &&
    deployment.deadlineAt?.getTime() === event.deadlineAt.getTime()
  ) {
    return Effect.succeed(unchanged());
  }
  return Effect.fail(
    new InvalidDeploymentTransition({
      deploymentId: deployment.id,
      state: deployment.state,
      event: event._tag,
    }),
  );
}

function instanceReportedTransition({
  deployment,
  event,
}: {
  deployment: DeploymentStateSnapshot;
  event: Extract<DeploymentEvent, { _tag: 'InstanceReported' }>;
}): Effect.Effect<Option.Option<DeploymentTransition>> {
  if (
    deployment.state !== 'starting' ||
    deployment.targetGeneration === null ||
    event.observedGeneration < deployment.targetGeneration
  ) {
    return Effect.succeed(unchanged());
  }
  if (event.instanceState === 'running') {
    return Effect.succeed(
      Option.some(
        nextSnapshot({
          deployment,
          state: 'active',
          activatedAt: event.reportedAt,
        }),
      ),
    );
  }
  if (event.instanceState === 'failed') {
    return Effect.succeed(
      Option.some(
        nextSnapshot({
          deployment,
          state: 'failed',
          failureReason: event.message ?? 'The instance failed without an operator message.',
        }),
      ),
    );
  }
  return Effect.succeed(unchanged());
}

function deadlineReachedTransition({
  deployment,
  event,
}: {
  deployment: DeploymentStateSnapshot;
  event: Extract<DeploymentEvent, { _tag: 'DeadlineReached' }>;
}): Effect.Effect<Option.Option<DeploymentTransition>> {
  if (
    deployment.state !== 'starting' ||
    deployment.deadlineAt === null ||
    event.at < deployment.deadlineAt
  ) {
    return Effect.succeed(unchanged());
  }
  return Effect.succeed(
    Option.some(
      nextSnapshot({
        deployment,
        state: 'failed',
        failureReason: `Deployment did not become active before ${deployment.deadlineAt.toISOString()}.`,
      }),
    ),
  );
}

function cancellationRequestedTransition(
  deployment: DeploymentStateSnapshot,
): Effect.Effect<Option.Option<DeploymentTransition>, InvalidDeploymentTransition> {
  if (deployment.state === 'pending' || deployment.state === 'starting') {
    return Effect.succeed(Option.some(nextSnapshot({ deployment, state: 'cancelled' })));
  }
  if (deployment.state === 'cancelled') {
    return Effect.succeed(unchanged());
  }
  return Effect.fail(
    new InvalidDeploymentTransition({
      deploymentId: deployment.id,
      state: deployment.state,
      event: 'CancellationRequested',
    }),
  );
}

function replacementActivatedTransition({
  deployment,
  event,
}: {
  deployment: DeploymentStateSnapshot;
  event: Extract<DeploymentEvent, { _tag: 'ReplacementActivated' }>;
}): Effect.Effect<Option.Option<DeploymentTransition>, InvalidDeploymentTransition> {
  if (deployment.state === 'active') {
    return Effect.succeed(
      Option.some(
        nextSnapshot({
          deployment,
          state: 'superseded',
          activatedAt: deployment.activatedAt ?? event.at,
        }),
      ),
    );
  }
  if (deployment.state === 'superseded') {
    return Effect.succeed(unchanged());
  }
  return Effect.fail(
    new InvalidDeploymentTransition({
      deploymentId: deployment.id,
      state: deployment.state,
      event: event._tag,
    }),
  );
}

export function decideDeploymentTransition({
  deployment,
  event,
}: {
  deployment: DeploymentStateSnapshot;
  event: DeploymentEvent;
}): Effect.Effect<Option.Option<DeploymentTransition>, InvalidDeploymentTransition> {
  return Match.value(event).pipe(
    Match.tagsExhaustive({
      Scheduled: (scheduled) => scheduledTransition({ deployment, event: scheduled }),
      InstanceReported: (reported) => instanceReportedTransition({ deployment, event: reported }),
      DeadlineReached: (deadline) => deadlineReachedTransition({ deployment, event: deadline }),
      CancellationRequested: () => cancellationRequestedTransition(deployment),
      ReplacementActivated: (replacement) =>
        replacementActivatedTransition({ deployment, event: replacement }),
    }),
  );
}
