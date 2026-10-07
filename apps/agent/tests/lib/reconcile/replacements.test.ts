import { expect, test } from 'bun:test';
import { Effect, Either, Layer } from 'effect';
import { CommandFailed } from '#lib/exec.ts';
import { waitingPort } from '#lib/proxy/listener.ts';
import { forwardedInstances, routes } from '#lib/reconcile/network.ts';
import type { ReconcilePlan } from '#lib/reconcile/plan.ts';
import { duringReplacements } from '#lib/reconcile/replacements.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { AppActivator } from '#services/app-activator.service.ts';
import { CaddyProxy } from '#services/caddy-proxy.service.ts';
import { HostFirewall } from '#services/host-firewall.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import {
  APP_ID,
  desiredInstance,
  FIRST_HOST_PORT,
  instanceRecord,
} from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';

const plan: ReconcilePlan = {
  instances: [{ action: 'replace', desired: desiredInstance() }],
  volumes: [],
  checkpoints: [],
  exports: [],
};

function host({ refuseFirewall, refuseProxy }: { refuseFirewall: boolean; refuseProxy: boolean }) {
  const steps: string[] = [];
  const commands = recordingCommands((request) => {
    if (request.command.includes('-f')) {
      steps.push('withdraw');
      return refuseFirewall
        ? Effect.fail(
            new CommandFailed({
              command: request.command,
              result: { code: 1, stdout: '', stderr: 'refused' },
            }),
          )
        : succeeding();
    }
    return succeeding();
  });
  const activators = Layer.succeed(
    AppActivator,
    AppActivator.make({
      serve: () =>
        Effect.sync(function listen() {
          steps.push('listen');
        }),
    }),
  );
  const proxy = Layer.succeed(
    CaddyProxy,
    CaddyProxy.make({
      apply: (targets) =>
        Effect.flatMap(targets, (projected) => {
          steps.push('switch');
          return refuseProxy &&
            projected.some((route) => route.hostPort === waitingPort(FIRST_HOST_PORT))
            ? Effect.fail(
                new CommandFailed({
                  command: ['systemctl', 'reload'],
                  result: { code: 1, stdout: '', stderr: 'reload refused' },
                }),
              )
            : Effect.void;
        }),
    }),
  );
  const run = provided(
    Layer.mergeAll(
      AgentState.Default,
      SlotAllocator.DefaultWithoutDependencies,
      HostFirewall.Default,
      activators,
      proxy,
    ).pipe(
      Layer.provideMerge(agentConfig({ controlPlaneCidrsV4: [], controlPlaneCidrsV6: [] })),
      Layer.provideMerge(commands.layer),
      Layer.provideMerge(platform),
    ),
  );
  return { run, steps };
}

test('the listener takes over before the outgoing guest is stopped', () => {
  const { run, steps } = host({ refuseFirewall: false, refuseProxy: false });
  return run(
    Effect.gen(function* () {
      yield* (yield* SlotAllocator).allocate(APP_ID);
      yield* AgentState.putRecord(instanceRecord());
      yield* duringReplacements({
        plan,
        effect: Effect.gen(function* () {
          steps.push('stop');
          expect(yield* forwardedInstances).toEqual([]);
          yield* AgentState.dropRecord(APP_ID);
          expect((yield* AgentState.snapshot).replacing.has(APP_ID)).toBe(true);
          expect((yield* routes)[0]?.hostPort).toBe(waitingPort(FIRST_HOST_PORT));
          yield* AgentState.putRecord(instanceRecord({ state: 'starting' }));
        }),
      });
      const handoff = ['listen', 'switch', 'withdraw', 'stop'];
      expect(steps.slice(0, handoff.length)).toEqual(handoff);
      expect((yield* AgentState.snapshot).replacing.size).toBe(0);
    }),
  );
});

test('a failed route withdrawal leaves the guest up and schedules another reconcile', () => {
  const { run, steps } = host({ refuseFirewall: true, refuseProxy: false });
  return run(
    Effect.gen(function* () {
      yield* (yield* SlotAllocator).allocate(APP_ID);
      yield* AgentState.putRecord(instanceRecord());
      const result = yield* Effect.either(
        duringReplacements({
          plan,
          effect: Effect.sync(function stop() {
            steps.push('stop');
          }),
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
      expect(steps).not.toContain('stop');
      const handoff = ['listen', 'switch', 'withdraw'];
      expect(steps.slice(0, handoff.length)).toEqual(handoff);
      const current = yield* AgentState.snapshot;
      expect(current.records.get(APP_ID)?.state).toBe('running');
      expect(current.replacing.size).toBe(0);
      expect(current.deferredWork).toBe(true);
    }),
  );
});

test('a failed Caddy handoff leaves the guest and its forward serving', () => {
  const { run, steps } = host({ refuseFirewall: false, refuseProxy: true });
  return run(
    Effect.gen(function* () {
      yield* (yield* SlotAllocator).allocate(APP_ID);
      yield* AgentState.putRecord(instanceRecord());
      const result = yield* Effect.either(
        duringReplacements({
          plan,
          effect: Effect.sync(function stop() {
            steps.push('stop');
          }),
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
      expect(steps.slice(0, 2)).toEqual(['listen', 'switch']);
      expect(steps).not.toContain('stop');
      const current = yield* AgentState.snapshot;
      expect(current.records.get(APP_ID)?.state).toBe('running');
      expect(current.replacing.size).toBe(0);
      expect(current.deferredWork).toBe(true);
      expect((yield* forwardedInstances)[0]?.appId).toBe(APP_ID);
      expect((yield* routes)[0]?.hostPort).toBe(FIRST_HOST_PORT);
    }),
  );
});
