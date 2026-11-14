import { Effect, Option, Ref } from 'effect';
import { parseAppTraffic } from '#lib/network/counters.ts';
import { type FirewallState, NFTABLES_TABLE, renderRuleset } from '#lib/network/firewall.ts';
import { FirewallVerificationFailed, requireRuleset } from '#lib/network/isolation.ts';
import { listTapNames } from '#lib/network/tap.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

type Applied = {
  readonly source: string;
  readonly installed: string;
};

export class HostFirewall extends Effect.Service<HostFirewall>()('HostFirewall', {
  effect: Effect.gen(function* () {
    const applied = yield* Ref.make(Option.none<Applied>());
    const routing = yield* Effect.makeSemaphore(1);

    function nft(input: string) {
      return stdoutOf({
        command: ['nft', '-j', '-e', '-f', '-'],
        stdin: input,
        timeout: '5 seconds',
      });
    }

    function setTaps(state: 'up' | 'down') {
      return Effect.flatMap(listTapNames, (names) =>
        Effect.forEach(
          names,
          (name) =>
            stdoutOf({
              command: ['ip', 'link', 'set', 'dev', name, state],
              timeout: '5 seconds',
            }).pipe(Effect.either),
          { concurrency: 'unbounded' },
        ).pipe(Effect.flatMap((results) => Effect.forEach(results, (result) => result))),
      );
    }

    const contain = Ref.set(applied, Option.none()).pipe(Effect.andThen(setTaps('down')));
    const inspect = stdoutOf({
      command: ['nft', '-j', 'list', 'ruleset'],
      timeout: '5 seconds',
    }).pipe(Effect.flatMap(requireRuleset));

    const write = Effect.fn('HostFirewall.apply')(function* (state: FirewallState) {
      const source = renderRuleset(state);
      const last = yield* Ref.get(applied);
      let reconnect = Option.isNone(last);
      if (Option.isSome(last)) {
        const current = yield* Effect.option(inspect);
        if (Option.isSome(current) && current.value === last.value.installed) {
          if (last.value.source === source) {
            return;
          }
        } else {
          yield* contain;
          reconnect = true;
        }
      }
      // Echo describes the committed transaction, so a flush between the write and read cannot
      // become our baseline. Counters are excluded from comparison; rule order is preserved.
      const installed = yield* nft(source).pipe(Effect.flatMap(requireRuleset));
      if ((yield* inspect) !== installed) {
        return yield* new FirewallVerificationFailed();
      }
      if (reconnect) {
        yield* setTaps('up');
      }
      yield* Ref.set(applied, Option.some({ source, installed }));
    });

    function failClosed<A, E, R>(effect: Effect.Effect<A, E, R>) {
      return effect.pipe(Effect.tapError(() => contain));
    }

    function apply<R>(state: Effect.Effect<FirewallState, never, R>) {
      return routing
        .withPermits(1)(failClosed(Effect.flatMap(state, write)))
        .pipe(Effect.uninterruptible);
    }

    function whileIsolated<A, E, R>(effect: Effect.Effect<A, E, R>) {
      return routing
        .withPermits(1)(
          Effect.gen(function* () {
            const last = yield* Ref.get(applied);
            yield* failClosed(
              Effect.gen(function* () {
                if (Option.isNone(last) || (yield* inspect) !== last.value.installed) {
                  return yield* new FirewallVerificationFailed();
                }
              }),
            );
            return yield* effect;
          }),
        )
        .pipe(Effect.uninterruptible);
    }

    return {
      apply,
      whileIsolated,
      traffic: Effect.map(
        stdoutOf({ command: ['nft', '-j', 'list', 'counters', 'table', 'ip', NFTABLES_TABLE] }),
        parseAppTraffic,
      ),
    };
  }),
}) {}
