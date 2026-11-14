import { describe, expect, test } from 'bun:test';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import type { FirewallState } from '#lib/network/firewall.ts';
import type { CommandRunner } from '#services/command-runner.service.ts';
import { HostFirewall } from '#services/host-firewall.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { kernelRuleset } from '#tests/support/firewall.ts';

const STATE: FirewallState = { instances: [], controlPlaneCidrsV4: [], controlPlaneCidrsV6: [] };

function fixture() {
  const expected = JSON.stringify(kernelRuleset());
  const kernel = {
    installed: expected,
    writeFails: false,
    readFails: false,
    corruptAfterWrite: false,
    downFails: false,
  };
  function write() {
    if (kernel.writeFails) {
      return succeeding({ code: 1 });
    }
    kernel.installed = kernel.corruptAfterWrite ? '{"nftables":[]}' : expected;
    return succeeding({ stdout: expected });
  }
  const recorder = recordingCommands((request) => {
    if (request.command[0] === 'ip') {
      if (request.command.includes('-json')) {
        return succeeding({ stdout: '[{"ifname":"nbr0"},{"ifname":"nbr1"},{"ifname":"eth0"}]' });
      }
      return succeeding({
        code:
          kernel.downFails && request.command.includes('nbr0') && request.command.includes('down')
            ? 1
            : 0,
      });
    }
    if (request.command.includes('-f')) {
      return write();
    }
    return succeeding({ code: kernel.readFails ? 1 : 0, stdout: kernel.installed });
  });
  const layer = HostFirewall.Default.pipe(Layer.provideMerge(recorder.layer));
  function run<A, E>(effect: Effect.Effect<A, E, HostFirewall | CommandRunner>) {
    return Effect.runPromise(effect.pipe(Effect.provide(layer)));
  }
  return { kernel, recorder, run };
}

const apply = Effect.flatMap(HostFirewall, (firewall) => firewall.apply(Effect.succeed(STATE)));

describe('firewall verification and containment', () => {
  test('unchanged rules preserve counters by avoiding a rewrite', async () => {
    const host = fixture();
    await host.run(
      Effect.gen(function* () {
        yield* apply;
        yield* apply;
      }),
    );
    expect(host.recorder.commands.filter((request) => request.command.includes('-f'))).toHaveLength(
      1,
    );
  });

  test('a flush preserving table handles disconnects guests before repair', async () => {
    const host = fixture();
    await host.run(
      Effect.gen(function* () {
        yield* apply;
        host.recorder.commands.length = 0;
        host.kernel.installed = '{"nftables":[]}';
        yield* apply;
      }),
    );
    const steps = host.recorder.commands.map((request) => request.command.join(' '));
    expect(steps.indexOf('ip link set dev nbr0 down')).toBeLessThan(
      steps.indexOf('nft -j -e -f -'),
    );
    expect(steps.at(-1)).toBe('ip link set dev nbr1 up');
    expect(steps.some((step) => step.includes('dev eth0'))).toBe(false);
  });

  test.each(['writeFails', 'readFails', 'corruptAfterWrite'] as const)(
    '%s keeps existing guests disconnected and refuses concurrent network setup until recovery',
    async (failure) => {
      const host = fixture();
      await host.run(
        Effect.gen(function* () {
          const firewall = yield* HostFirewall;
          yield* apply;
          host.recorder.commands.length = 0;
          host.kernel.installed = '{"nftables":[]}';
          host.kernel[failure] = true;
          expect((yield* Effect.either(apply))._tag).toBe('Left');
          let connected = false;
          const attempt = yield* Effect.either(
            firewall.whileIsolated(
              Effect.sync(() => {
                connected = true;
              }),
            ),
          );
          expect(attempt._tag).toBe('Left');
          expect(connected).toBe(false);
          expect(host.recorder.commands.some((request) => request.command.at(-1) === 'up')).toBe(
            false,
          );
          host.kernel[failure] = false;
          yield* apply;
          yield* firewall.whileIsolated(
            Effect.sync(() => {
              connected = true;
            }),
          );
          expect(connected).toBe(true);
        }),
      );
    },
  );

  test('failure to disconnect one tap does not skip the other guests', async () => {
    const host = fixture();
    await host.run(
      Effect.gen(function* () {
        yield* apply;
        host.kernel.downFails = true;
        host.kernel.installed = '{"nftables":[]}';
        expect((yield* Effect.either(apply))._tag).toBe('Left');
      }),
    );
    expect(
      host.recorder.commands.some(
        (request) => request.command.join(' ') === 'ip link set dev nbr1 down',
      ),
    ).toBe(true);
  });

  test('containment waits for network setup already holding the isolation lock', async () => {
    const host = fixture();
    await host.run(
      Effect.gen(function* () {
        yield* apply;
        const firewall = yield* HostFirewall;
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const setup = yield* Effect.fork(
          firewall.whileIsolated(
            Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
          ),
        );
        yield* Deferred.await(entered);
        host.kernel.writeFails = true;
        host.kernel.installed = '{"nftables":[]}';
        const repair = yield* Effect.fork(Effect.either(apply));
        yield* Effect.yieldNow();
        expect(host.recorder.commands.some((request) => request.command.at(-1) === 'down')).toBe(
          false,
        );
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(setup);
        expect((yield* Fiber.join(repair))._tag).toBe('Left');
        expect(host.recorder.commands.some((request) => request.command.at(-1) === 'down')).toBe(
          true,
        );
      }),
    );
  });
});
