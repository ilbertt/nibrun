import type { DeploymentId, HostReportedState } from '@repo/protocol';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as Schedule from 'effect/Schedule';
import type { DeploymentRepository } from '#repositories/deployment.repository.ts';
import { deploymentStateStoreLayer } from '#repositories/deployment.repository.ts';
import {
  type DeploymentEvent,
  DeploymentStateMachine,
  type DeploymentStateMachineError,
  DeploymentStateMachineLive,
  type DeploymentTransitionResult,
} from '#services/deployment-state-machine.ts';
import { Service } from '#services/service.ts';

const DEADLINE_SWEEP_BATCH_SIZE = 100;
const DEADLINE_SWEEP_INTERVAL_SECONDS = 5;
const DEADLINE_SWEEP_SCHEDULE = Schedule.spaced(
  Duration.seconds(DEADLINE_SWEEP_INTERVAL_SECONDS),
).pipe(Schedule.jittered);

export class DeploymentService extends Service {
  readonly #runtime: ManagedRuntime.ManagedRuntime<DeploymentStateMachine, never>;
  #deadlineSweep: Fiber.RuntimeFiber<unknown, never> | null = null;
  #disposed = false;

  constructor({ deploymentRepository }: { deploymentRepository: DeploymentRepository }) {
    super();
    const stateMachineLayer = DeploymentStateMachineLive.pipe(
      Layer.provide(deploymentStateStoreLayer({ repository: deploymentRepository })),
    );
    this.#runtime = ManagedRuntime.make(stateMachineLayer);
  }

  transition({
    deploymentId,
    event,
  }: {
    deploymentId: DeploymentId;
    event: DeploymentEvent;
  }): Promise<DeploymentTransitionResult> {
    return this.#runtime.runPromise(DeploymentStateMachine.transition({ deploymentId, event }));
  }

  observeReport({
    reported,
  }: {
    reported: HostReportedState;
  }): Promise<readonly DeploymentTransitionResult[]> {
    return this.#runtime.runPromise(DeploymentStateMachine.observeReport(reported));
  }

  startDeadlineSweep(): void {
    if (this.#deadlineSweep || this.#disposed) {
      return;
    }
    const logger = this.logger;
    const sweep = DeploymentStateMachine.expireOverdue({ limit: DEADLINE_SWEEP_BATCH_SIZE }).pipe(
      Effect.tap((results) => {
        const transitions = results.filter((result) => result._tag === 'Transitioned').length;
        if (transitions === 0) {
          return Effect.void;
        }
        return Effect.sync(() => {
          logger.info('expired deployment deadlines', { deployments: transitions });
        });
      }),
      Effect.catchAll((error: DeploymentStateMachineError) =>
        Effect.sync(() => {
          logger.error('deployment deadline sweep failed', error);
        }),
      ),
      Effect.repeat(DEADLINE_SWEEP_SCHEDULE),
    );
    this.#deadlineSweep = this.#runtime.runFork(sweep);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (this.#deadlineSweep) {
      await this.#runtime.runPromise(Fiber.interrupt(this.#deadlineSweep));
      this.#deadlineSweep = null;
    }
    await this.#runtime.dispose();
  }
}
