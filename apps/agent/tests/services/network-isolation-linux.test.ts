import { expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import type { FirewallState } from '#lib/network/firewall.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { HostFirewall } from '#services/host-firewall.service.ts';
import { succeeding } from '#tests/support/commands.ts';
import {
  createIsolationNetwork,
  GUEST_NAMESPACE,
  networkCommand,
  reaches,
} from '#tests/support/isolation-network.ts';
import { platform, provided } from '#tests/support/run.ts';

const TEST_TIMEOUT_MS = 30_000;
const STATE: FirewallState = {
  instances: [],
  controlPlaneCidrsV4: ['10.43.0.0/16'],
  controlPlaneCidrsV6: ['2600:1f18:abcd::/56'],
};
const PUBLIC = ['203.0.113.2', '2001:db8:2::2'];
const INTERNAL = [
  '10.201.0.1',
  '169.254.169.254',
  '10.43.0.134',
  '10.201.0.6',
  'fd00:ec2::254',
  '2600:1f18:abcd::2',
];
const run = provided(CommandRunner.Default.pipe(Layer.provideMerge(platform)));

function reachable(address: string) {
  return reaches({ namespace: GUEST_NAMESPACE, address });
}

test.skipIf(process.env.NIBRUN_TEST_NETWORK_PROBES !== '1')(
  'tenant packets cannot reach internal services before or after firewall failure and recovery',
  async () => {
    const network = createIsolationNetwork();
    try {
      await network.start();
      for (const address of [...PUBLIC, ...INTERNAL]) {
        expect(reachable(address)).toBe(true);
      }
      await run(
        Effect.gen(function* () {
          const real = yield* CommandRunner;
          let refuseWrites = false;
          const runner = Layer.succeed(
            CommandRunner,
            CommandRunner.make({
              run: (request) =>
                refuseWrites && request.command[0] === 'nft' && request.command.includes('-f')
                  ? succeeding({ code: 1, stderr: 'injected write failure' })
                  : real.run(request),
            }),
          );
          yield* Effect.gen(function* () {
            const firewall = yield* HostFirewall;
            const apply = firewall.apply(Effect.succeed(STATE));
            yield* apply;
            for (const address of PUBLIC) {
              expect(reachable(address)).toBe(true);
            }
            for (const address of INTERNAL) {
              expect(reachable(address)).toBe(false);
            }
            networkCommand(['nft', 'flush', 'chain', 'ip', 'nibrun', 'forward']);
            expect(reachable('10.43.0.134')).toBe(true);
            refuseWrites = true;
            expect((yield* Effect.either(apply))._tag).toBe('Left');
            for (const address of [...PUBLIC, ...INTERNAL]) {
              expect(reachable(address)).toBe(false);
            }
            refuseWrites = false;
            yield* apply;
            for (const address of PUBLIC) {
              expect(reachable(address)).toBe(true);
            }
            for (const address of INTERNAL) {
              expect(reachable(address)).toBe(false);
            }
          }).pipe(Effect.provide(HostFirewall.Default.pipe(Layer.provideMerge(runner))));
        }),
      );
    } finally {
      await network.close();
    }
  },
  TEST_TIMEOUT_MS,
);
