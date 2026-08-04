import type { DeploymentId, DeploymentState } from '@repo/protocol';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import type { Queries } from '#db/queries.gen.d.ts';
import { Repository } from '#repositories/repository.ts';

export type DeploymentStateSnapshot = {
  readonly id: DeploymentId;
  readonly state: DeploymentState;
  readonly targetGeneration: number | null;
  readonly deadlineAt: Date | null;
  readonly activatedAt: Date | null;
  readonly failureReason: string | null;
};

export type DeploymentTransition = {
  readonly deploymentId: DeploymentId;
  readonly expectedState: DeploymentState;
  readonly next: Omit<DeploymentStateSnapshot, 'id'>;
};

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

export class DeploymentStateStore extends Effect.Tag('#repositories/deployment-state-store')<
  DeploymentStateStore,
  DeploymentStateStoreService
>() {}

type DeploymentStateRow = Queries['SelectDeploymentState'];
type ExpiredDeploymentStateRow = Queries['SelectExpiredDeploymentStates'];
type TransitionedDeploymentStateRow = Queries['CompareAndSetDeploymentState'];

function toSnapshot(
  row: DeploymentStateRow | ExpiredDeploymentStateRow | TransitionedDeploymentStateRow,
): DeploymentStateSnapshot {
  return {
    id: row.id as DeploymentId,
    state: row.state as DeploymentState,
    targetGeneration: row.targetGeneration,
    deadlineAt: row.deadlineAt,
    activatedAt: row.activatedAt,
    failureReason: row.failureReason,
  };
}

export class DeploymentRepository extends Repository {
  async find({
    deploymentId,
  }: {
    deploymentId: DeploymentId;
  }): Promise<DeploymentStateSnapshot | null> {
    const rows = await this.sql.SelectDeploymentState`
      SELECT
        id,
        state,
        target_generation AS "targetGeneration",
        deadline_at AS "deadlineAt",
        activated_at AS "activatedAt",
        failure_reason AS "failureReason"
      FROM nibrun.deployments
      WHERE id = CASE
        WHEN pg_input_is_valid(${deploymentId}::text, 'uuid')
          THEN ${deploymentId}::text::uuid
      END
    `;
    const row = rows[0];
    return row ? toSnapshot(row) : null;
  }

  async findExpired({
    asOf,
    limit,
  }: {
    asOf: Date;
    limit: number;
  }): Promise<DeploymentStateSnapshot[]> {
    const rows = await this.sql.SelectExpiredDeploymentStates`
      SELECT
        id,
        state,
        target_generation AS "targetGeneration",
        deadline_at AS "deadlineAt",
        activated_at AS "activatedAt",
        failure_reason AS "failureReason"
      FROM nibrun.deployments
      WHERE state = 'starting'
        AND deadline_at <= ${asOf}
      ORDER BY deadline_at, id
      LIMIT ${limit}
    `;
    return rows.map(toSnapshot);
  }

  async transition({
    deploymentId,
    expectedState,
    next,
  }: DeploymentTransition): Promise<DeploymentStateSnapshot | null> {
    const rows = await this.sql.CompareAndSetDeploymentState`
      UPDATE nibrun.deployments
      SET
        state = ${next.state},
        target_generation = ${next.targetGeneration},
        deadline_at = ${next.deadlineAt},
        activated_at = ${next.activatedAt},
        failure_reason = ${next.failureReason}
      WHERE id = CASE
          WHEN pg_input_is_valid(${deploymentId}::text, 'uuid')
            THEN ${deploymentId}::text::uuid
        END
        AND state = ${expectedState}
      RETURNING
        id,
        state,
        target_generation AS "targetGeneration",
        deadline_at AS "deadlineAt",
        activated_at AS "activatedAt",
        failure_reason AS "failureReason"
    `;
    const row = rows[0];
    return row ? toSnapshot(row) : null;
  }
}

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
