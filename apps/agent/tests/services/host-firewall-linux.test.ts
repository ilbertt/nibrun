import { expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import type { CommandRequest } from '#lib/exec.ts';
import type { FirewallState } from '#lib/network/firewall.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { HostFirewall } from '#services/host-firewall.service.ts';
import { succeeding } from '#tests/support/commands.ts';
import { platform, provided } from '#tests/support/run.ts';

const TEST_TIMEOUT_MS = 30_000;
const enabled = process.env.NIBRUN_TEST_ISOLATION === '1';
const TAP = 'nbr9001';
const MANAGEMENT = 'isolation-mgmt';
const STATE: FirewallState = {
  instances: [],
  controlPlaneCidrsV4: ['10.43.0.0/16'],
  controlPlaneCidrsV6: ['2600:1f18:abcd::/56'],
};

function command(args: string[]) {
  const result = Bun.spawnSync(args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString();
}

function linkIsUp(name: string) {
  return JSON.parse(command(['ip', '-json', 'link', 'show', 'dev', name]))[0].flags.includes('UP');
}

function writes(request: CommandRequest) {
  return request.command[0] === 'nft' && request.command.includes('-f');
}

const run = provided(CommandRunner.Default.pipe(Layer.provideMerge(platform)));

test.skipIf(!enabled)(
  'kernel rules are repaired in place and failed verification disconnects existing tenant interfaces',
  async () => {
    expect(process.getuid?.()).toBe(0);
    command(['ip', 'link', 'add', TAP, 'type', 'dummy']);
    command(['ip', 'link', 'add', MANAGEMENT, 'type', 'dummy']);
    command(['ip', 'link', 'set', MANAGEMENT, 'up']);
    try {
      await run(
        Effect.gen(function* () {
          const real = yield* CommandRunner;
          let refuseWrites = false;
          let corruptAfterWrite = false;
          const runner = Layer.succeed(
            CommandRunner,
            CommandRunner.make({
              run: (request) => {
                if (writes(request) && refuseWrites) {
                  return succeeding({ code: 1, stderr: 'injected write failure' });
                }
                return real.run(request).pipe(
                  Effect.tap(() => {
                    if (writes(request) && corruptAfterWrite) {
                      command(['nft', 'flush', 'chain', 'ip', 'nibrun', 'input']);
                    }
                    return Effect.void;
                  }),
                );
              },
            }),
          );
          const layer = HostFirewall.Default.pipe(Layer.provideMerge(runner));
          yield* Effect.gen(function* () {
            const firewall = yield* HostFirewall;
            const apply = firewall.apply(Effect.succeed(STATE));
            yield* apply;
            expect(linkIsUp(TAP)).toBe(true);
            const original = command(['nft', '-j', 'list', 'tables']);
            yield* apply;
            expect(command(['nft', '-j', 'list', 'tables'])).toBe(original);
            for (const family of ['ip', 'ip6']) {
              const original = command(['nft', '-j', 'list', 'tables']);
              command(['nft', 'flush', 'chain', family, 'nibrun', 'forward']);
              expect(command(['nft', '-j', 'list', 'tables'])).toBe(original);
              yield* apply;
              expect(command(['nft', 'list', 'chain', family, 'nibrun', 'forward'])).toContain(
                'reject',
              );
            }
            command(['nft', 'flush', 'chain', 'ip', 'nibrun', 'input']);
            refuseWrites = true;
            expect((yield* Effect.either(apply))._tag).toBe('Left');
            expect(linkIsUp(TAP)).toBe(false);
            expect(linkIsUp(MANAGEMENT)).toBe(true);
            const attempt = firewall.whileIsolated(
              Effect.sync(() => command(['ip', 'link', 'set', TAP, 'up'])),
            );
            expect((yield* Effect.either(attempt))._tag).toBe('Left');
            expect(linkIsUp(TAP)).toBe(false);
            refuseWrites = false;
            corruptAfterWrite = true;
            expect((yield* Effect.either(apply))._tag).toBe('Left');
            expect(linkIsUp(TAP)).toBe(false);
            corruptAfterWrite = false;
            yield* apply;
            expect(linkIsUp(TAP)).toBe(true);
          }).pipe(Effect.provide(layer));
        }),
      );
    } finally {
      command(['ip', 'link', 'del', TAP]);
      command(['ip', 'link', 'del', MANAGEMENT]);
      for (const family of ['ip', 'ip6']) {
        command(['nft', 'delete', 'table', family, 'nibrun']);
      }
    }
  },
  TEST_TIMEOUT_MS,
);
