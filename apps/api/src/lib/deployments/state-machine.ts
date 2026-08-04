import type { DeploymentId } from '@repo/protocol';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import {
  ConcurrentDeploymentTransition,
  DeploymentEvent,
  DeploymentNotFound,
  type DeploymentStateMachineError,
  DeploymentTransitionResult,
} from '#lib/deployments/model.ts';
import { DeploymentStateStore } from '#lib/deployments/store.ts';
import { decideDeploymentTransition } from '#lib/deployments/transitions.ts';

const TRANSITION_RETRIES = 3;

export class DeploymentStateMachine extends Effect.Tag('#lib/deployments/state-machine')<
  DeploymentStateMachine,
  {
    transition(input: {
      deploymentId: DeploymentId;
      event: DeploymentEvent;
    }): Effect.Effect<DeploymentTransitionResult, DeploymentStateMachineError>;
    expireOverdue(input: {
      limit: number;
    }): Effect.Effect<readonly DeploymentTransitionResult[], DeploymentStateMachineError>;
  }
>() {}

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
  const transition = yield* decideDeploymentTransition({ deployment, event });
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
      expireOverdue(input) {
        return expireOverdue(input).pipe(Effect.provideService(DeploymentStateStore, store));
      },
    };
  }),
);
