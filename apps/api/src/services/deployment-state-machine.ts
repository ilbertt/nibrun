import type {
  DeploymentId,
  DeploymentState,
  HostReportedState,
  InstanceState,
} from '@repo/protocol';
import * as Data from 'effect/Data';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Match from 'effect/Match';
import * as Option from 'effect/Option';
import type {
  DeploymentPersistenceError,
  DeploymentStateSnapshot,
  DeploymentTransition,
} from '#repositories/deployment.repository.ts';
import { DeploymentStateStore } from '#repositories/deployment.repository.ts';

const TRANSITION_RETRIES = 3;

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

export class DeploymentStateMachine extends Effect.Tag('#services/deployment-state-machine')<
  DeploymentStateMachine,
  {
    transition(input: {
      deploymentId: DeploymentId;
      event: DeploymentEvent;
    }): Effect.Effect<DeploymentTransitionResult, DeploymentStateMachineError>;
    observeReport(
      report: HostReportedState,
    ): Effect.Effect<readonly DeploymentTransitionResult[], DeploymentStateMachineError>;
    expireOverdue(input: {
      limit: number;
    }): Effect.Effect<readonly DeploymentTransitionResult[], DeploymentStateMachineError>;
  }
>() {}

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

function decideTransition({
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

const transitionOnce = Effect.fn('DeploymentStateMachine.transitionOnce')(function* ({
  deploymentId,
  event,
}: {
  deploymentId: DeploymentId;
  event: DeploymentEvent;
}) {
  yield* Effect.annotateCurrentSpan({ deploymentId, event: event._tag });
  const store = yield* DeploymentStateStore;
  const deployment = yield* store.find({ deploymentId }).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new DeploymentNotFound({ deploymentId })),
        onSome: Effect.succeed,
      }),
    ),
  );
  const transition = yield* decideTransition({ deployment, event });
  if (Option.isNone(transition)) {
    return DeploymentTransitionResult.Unchanged({ deployment });
  }
  const current = yield* store.transition(transition.value).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new ConcurrentDeploymentTransition({ deploymentId })),
        onSome: Effect.succeed,
      }),
    ),
  );
  return DeploymentTransitionResult.Transitioned({ previous: deployment, current });
});

function transitionWithRetry(input: {
  deploymentId: DeploymentId;
  event: DeploymentEvent;
}): Effect.Effect<DeploymentTransitionResult, DeploymentStateMachineError, DeploymentStateStore> {
  return transitionOnce(input).pipe(
    Effect.retry({
      times: TRANSITION_RETRIES,
      while: (error) => error._tag === 'ConcurrentDeploymentTransition',
    }),
  );
}

const observeReport = Effect.fn('DeploymentStateMachine.observeReport')(function* (
  report: HostReportedState,
) {
  const byDeployment = new Map<DeploymentId, (typeof report.instances)[number]>();
  for (const instance of report.instances) {
    byDeployment.set(instance.deploymentId, instance);
  }
  const results = yield* Effect.forEach(byDeployment.values(), (instance) =>
    transitionWithRetry({
      deploymentId: instance.deploymentId,
      event: DeploymentEvent.InstanceReported({
        observedGeneration: report.observedGeneration,
        instanceState: instance.state,
        reportedAt: new Date(report.reportedAt),
        message: instance.message ?? null,
      }),
    }).pipe(
      Effect.map(Option.some),
      Effect.catchTag('DeploymentNotFound', () => Effect.succeed(Option.none())),
    ),
  );
  return results.flatMap(Option.toArray);
});

const expireOverdue = Effect.fn('DeploymentStateMachine.expireOverdue')(function* ({
  limit,
}: {
  limit: number;
}) {
  const store = yield* DeploymentStateStore;
  const now = yield* DateTime.nowAsDate;
  const expired = yield* store.findExpired({ asOf: now, limit });
  return yield* Effect.forEach(expired, (deployment) =>
    transitionWithRetry({
      deploymentId: deployment.id,
      event: DeploymentEvent.DeadlineReached({ at: now }),
    }),
  );
});

export const DeploymentStateMachineLive = Layer.effect(
  DeploymentStateMachine,
  Effect.gen(function* () {
    const store = yield* DeploymentStateStore;
    return {
      transition(input) {
        return transitionWithRetry(input).pipe(Effect.provideService(DeploymentStateStore, store));
      },
      observeReport(report) {
        return observeReport(report).pipe(Effect.provideService(DeploymentStateStore, store));
      },
      expireOverdue(input) {
        return expireOverdue(input).pipe(Effect.provideService(DeploymentStateStore, store));
      },
    };
  }),
);
