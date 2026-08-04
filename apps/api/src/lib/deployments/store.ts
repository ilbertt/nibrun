import type { DeploymentId } from '@repo/protocol';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import type {
  DeploymentRepository,
  DeploymentStateSnapshot,
  DeploymentTransition,
} from '#repositories/deployment.repository.ts';

type DeploymentStateStoreService = {
  find(input: {
    deploymentId: DeploymentId;
  }): Effect.Effect<Option.Option<DeploymentStateSnapshot>, DeploymentPersistenceError>;
  findExpired(input: {
    asOf: Date;
    limit: number;
  }): Effect.Effect<readonly DeploymentStateSnapshot[], DeploymentPersistenceError>;
  transition(
    input: DeploymentTransition,
  ): Effect.Effect<Option.Option<DeploymentStateSnapshot>, DeploymentPersistenceError>;
};

export class DeploymentPersistenceError extends Data.TaggedError('DeploymentPersistenceError')<{
  operation: keyof DeploymentStateStoreService;
  cause: unknown;
}> {}

export class DeploymentStateStore extends Effect.Tag('#lib/deployments/state-store')<
  DeploymentStateStore,
  DeploymentStateStoreService
>() {}

function persistenceEffect<Value>({
  operation,
  execute,
}: {
  operation: DeploymentPersistenceError['operation'];
  execute: () => Promise<Value>;
}): Effect.Effect<Value, DeploymentPersistenceError> {
  return Effect.tryPromise({
    try: execute,
    catch: (cause) => new DeploymentPersistenceError({ operation, cause }),
  });
}

export function deploymentStateStoreLayer({
  repository,
}: {
  repository: DeploymentRepository;
}): Layer.Layer<DeploymentStateStore> {
  return Layer.succeed(DeploymentStateStore, {
    find({ deploymentId }) {
      return persistenceEffect({
        operation: 'find',
        execute: async () => Option.fromNullable(await repository.find({ deploymentId })),
      });
    },
    findExpired({ asOf, limit }) {
      return persistenceEffect({
        operation: 'findExpired',
        execute: async () => await repository.findExpired({ asOf, limit }),
      });
    },
    transition(input) {
      return persistenceEffect({
        operation: 'transition',
        execute: async () => Option.fromNullable(await repository.transition(input)),
      });
    },
  });
}
